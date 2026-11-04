import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import type { Response } from 'express';
import { z } from 'zod';
import { changePasswordSchema, loginSchema } from '@acc/contracts';
import type { ApiConfiguration } from '../config.ts';
import type { ApiRequest, AuthenticatedIdentity } from './types.ts';
import { ApiError } from '../common/errors.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { tokenMatches } from './credentials.ts';

type Human = {
  id: string;
  username: string;
  display_name: string;
  system_role: 'ADMIN' | 'USER';
  must_change_password: boolean;
  credential_version: number;
  disabled: boolean;
};
const dummy = `scrypt$131072$8$1$${'0'.repeat(32)}$${'0'.repeat(128)}`;
const save = (req: ApiRequest) =>
  new Promise<void>((resolve, reject) =>
    req.session.save((error) => (error ? reject(error) : resolve())),
  );
export class AuthService {
  private nextCleanup = 0;
  constructor(
    private config: ApiConfiguration,
    private pool: pg.Pool,
  ) {}
  async session(req: ApiRequest) {
    req.session.csrfToken ??= randomBytes(32).toString('hex');
    await save(req);
    return { csrfToken: req.session.csrfToken };
  }
  private identity(user: Human): AuthenticatedIdentity {
    return {
      id: user.id,
      kind: 'HUMAN',
      mode: 'COOKIE',
      scopes: [],
      user: {
        username: user.username,
        displayName: user.display_name,
        systemRole: user.system_role,
        mustChangePassword: user.must_change_password,
        credentialVersion: user.credential_version,
      },
    };
  }
  private async signedIn(req: ApiRequest, user: Human) {
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    const expiresAt = Date.now() + 60 * 60 * 1000;
    req.session.identity = {
      principalId: user.id,
      credentialVersion: user.credential_version,
      expiresAt,
    };
    req.session.csrfToken = randomBytes(32).toString('hex');
    req.session.cookie.maxAge = expiresAt - Date.now();
    await save(req);
    req.identity = this.identity(user);
  }
  private async throttle(key: string, limit: number) {
    if (Date.now() >= this.nextCleanup) {
      this.nextCleanup = Date.now() + 60000;
      await this.pool.query(
        "WITH expired AS (SELECT key FROM login_throttles WHERE resets_at<statement_timestamp()-interval '1 day' ORDER BY resets_at FOR UPDATE SKIP LOCKED LIMIT 100) DELETE FROM login_throttles t USING expired e WHERE t.key=e.key",
      );
    }
    const result = await this.pool.query<{ attempts: number }>(
      `INSERT INTO login_throttles(key,attempts,resets_at) VALUES ($1,1,clock_timestamp()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_throttles.resets_at<=clock_timestamp() THEN 1 ELSE login_throttles.attempts+1 END,resets_at=CASE WHEN login_throttles.resets_at<=clock_timestamp() THEN clock_timestamp()+interval '15 minutes' ELSE login_throttles.resets_at END RETURNING attempts`,
      [key],
    );
    if (result.rows[0]!.attempts > limit) throw new ApiError(429, 'LOGIN_THROTTLED');
  }
  async login(req: ApiRequest) {
    this.verifyCsrf(req);
    const input = loginSchema.parse(req.body);
    const key = (kind: string, value: string) =>
      createHmac('sha256', this.config.sessionSecret).update(`${kind}:${value}`).digest('hex');
    await this.throttle(key('ip', req.ip ?? 'unknown'), 50);
    const accountKey = key('account', input.username);
    await this.throttle(accountKey, 10);
    const result = await this.pool.query<Human & { password_hash: string }>(
      'SELECT p.id,p.disabled,u.* FROM local_users u JOIN principals p ON p.id=u.principal_id WHERE u.username=$1',
      [input.username],
    );
    const user = result.rows[0];
    if (
      !(await verifyPassword(input.password, user?.password_hash ?? dummy)) ||
      !user ||
      user.disabled
    )
      throw new ApiError(401, 'LOGIN_FAILED');
    // Check the version again under a lock before issuing the session: a concurrent
    // reset/disable must not authenticate the password that was just replaced.
    const db = await this.pool.connect();
    let confirmed: Human;
    try {
      await db.query('BEGIN');
      const live = await db.query<Human>(
        'SELECT p.id,p.disabled,u.* FROM local_users u JOIN principals p ON p.id=u.principal_id WHERE u.principal_id=$1 FOR SHARE OF u,p',
        [user.id],
      );
      if (
        !live.rows[0] ||
        live.rows[0].disabled ||
        live.rows[0].credential_version !== user.credential_version
      )
        throw new ApiError(401, 'LOGIN_FAILED');
      await db.query(
        'INSERT INTO security_events(id,actor_id,target_id,action) VALUES ($1,$2,$2,$3)',
        [randomUUID(), user.id, 'LOGIN'],
      );
      await db.query('DELETE FROM login_throttles WHERE key=$1', [accountKey]);
      await db.query('COMMIT');
      confirmed = live.rows[0];
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
    await this.signedIn(req, confirmed);
  }
  async authenticate(req: ApiRequest, audience = 'acc-api'): Promise<AuthenticatedIdentity> {
    const header = req.get('authorization');
    if (header) {
      const match = /^Bearer (acc_([a-f0-9-]{36})\.[A-Za-z0-9_-]{43})$/u.exec(header);
      if (!match || !z.uuid().safeParse(match[2]).success) throw new ApiError(401, 'INVALID_TOKEN');
      const target =
        audience === 'acc-api'
          ? 'api'
          : audience === `${this.config.publicOrigin}/mcp`
            ? 'mcp'
            : null;
      const found = await this.pool.query<{
        principal_id: string;
        token_hash: Buffer;
        scopes: string[];
      }>(
        `SELECT c.principal_id,c.token_hash,c.scopes FROM agent_credentials c JOIN principals p ON p.id=c.principal_id WHERE c.id=$1 AND NOT p.disabled AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND $2::text=ANY(c.audiences)`,
        [match[2], target],
      );
      const credential = found.rows[0];
      if (!credential || !tokenMatches(match[1]!, credential.token_hash))
        throw new ApiError(401, 'INVALID_TOKEN');
      return {
        id: credential.principal_id,
        kind: 'AGENT',
        mode: 'BEARER',
        scopes: credential.scopes,
      };
    }
    const identity = req.session.identity;
    if (
      !identity ||
      !Number.isInteger(identity.credentialVersion) ||
      identity.expiresAt <= Date.now()
    )
      throw new ApiError(401, 'AUTH_REQUIRED');
    const result = await this.pool.query<Human>(
      'SELECT p.id,p.disabled,u.* FROM local_users u JOIN principals p ON p.id=u.principal_id WHERE u.principal_id=$1 AND u.credential_version=$2 AND NOT p.disabled',
      [identity.principalId, identity.credentialVersion],
    );
    if (!result.rows[0]) throw new ApiError(401, 'AUTH_REQUIRED');
    return this.identity(result.rows[0]);
  }
  verifyCsrf(req: ApiRequest) {
    const supplied = Buffer.from(req.get('x-csrf-token') ?? ''),
      expected = Buffer.from(req.session.csrfToken ?? '');
    if (
      req.get('origin') !== this.config.publicOrigin ||
      !expected.length ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new ApiError(403, 'CSRF_INVALID');
    if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED');
  }
  async changePassword(req: ApiRequest) {
    if (req.identity?.mode !== 'COOKIE') throw new ApiError(403, 'COOKIE_AUTH_REQUIRED');
    const input = changePasswordSchema.parse(req.body);
    const user = (
      await this.pool.query<Human & { password_hash: string }>(
        'SELECT p.id,p.disabled,u.* FROM local_users u JOIN principals p ON p.id=u.principal_id WHERE u.principal_id=$1',
        [req.identity.id],
      )
    ).rows[0]!;
    if (!(await verifyPassword(input.currentPassword, user.password_hash)))
      throw new ApiError(400, 'PASSWORD_INCORRECT');
    if (input.newPassword === input.currentPassword) throw new ApiError(400, 'PASSWORD_UNCHANGED');
    const hash = await hashPassword(input.newPassword);
    const db = await this.pool.connect();
    let confirmed: Human;
    try {
      await db.query('BEGIN');
      const updated = await db.query<Human>(
        'UPDATE local_users SET password_hash=$1,credential_version=credential_version+1,must_change_password=false WHERE principal_id=$2 AND credential_version=$3 RETURNING principal_id AS id,*',
        [hash, user.id, user.credential_version],
      );
      if (!updated.rows[0]) throw new ApiError(409, 'VERSION_CONFLICT');
      await db.query(
        'INSERT INTO security_events(id,actor_id,target_id,action) VALUES ($1,$2,$2,$3)',
        [randomUUID(), user.id, 'PASSWORD_CHANGED'],
      );
      await db.query('COMMIT');
      confirmed = updated.rows[0];
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
    await this.signedIn(req, confirmed);
  }
  async logout(req: ApiRequest, res: Response) {
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((error) => (error ? reject(error) : resolve())),
    );
    res.clearCookie('acc.sid', {
      httpOnly: true,
      secure: this.config.secureCookie,
      sameSite: 'lax',
      path: '/',
    });
  }
}
