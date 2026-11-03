import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as oidc from 'openid-client';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type pg from 'pg';
import type { Response } from 'express';
import type { ApiConfiguration } from '../config.ts';
import { ApiError } from '../common/errors.ts';
import type { ApiRequest, AuthenticatedIdentity } from './types.ts';

const save = (req: ApiRequest) =>
  new Promise<void>((resolve, reject) =>
    req.session.save((error) => (error ? reject(error) : resolve())),
  );
export class OidcService {
  private jwks: ReturnType<typeof createRemoteJWKSet>;
  constructor(
    private config: ApiConfiguration,
    private pool: pg.Pool,
    private client: oidc.Configuration,
  ) {
    const jwksUri = client.serverMetadata().jwks_uri;
    if (!jwksUri) throw new Error('OIDC JWKS metadata is required');
    this.jwks = createRemoteJWKSet(new URL(jwksUri));
  }
  static async create(config: ApiConfiguration, pool: pg.Pool) {
    const client = await oidc.discovery(
      new URL(config.issuer),
      config.clientId,
      config.clientSecret,
      undefined,
      {
        execute:
          config.nodeEnv !== 'production' && new URL(config.issuer).protocol === 'http:'
            ? [oidc.allowInsecureRequests]
            : undefined,
        timeout: 10,
      },
    );
    const metadata = client.serverMetadata();
    for (const endpoint of [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.jwks_uri,
    ]) {
      if (!endpoint || new URL(endpoint).origin !== new URL(config.issuer).origin)
        throw new Error('OIDC endpoints must use the configured issuer origin');
    }
    return new OidcService(config, pool, client);
  }
  async login(req: ApiRequest, res: Response) {
    const verifier = oidc.randomPKCECodeVerifier(),
      state = oidc.randomState(),
      nonce = oidc.randomNonce();
    req.session.login = { verifier, state, nonce, startedAt: Date.now() };
    req.session.cookie.maxAge = 5 * 60 * 1000;
    await save(req);
    const url = oidc.buildAuthorizationUrl(this.client, {
      response_type: 'code',
      redirect_uri: this.config.callbackUrl,
      scope: 'openid profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    res.redirect(url.href);
  }
  async callback(req: ApiRequest, res: Response) {
    const login = req.session.login;
    delete req.session.login;
    await save(req);
    if (!login || Date.now() - login.startedAt > 5 * 60 * 1000)
      throw new ApiError(401, 'OIDC_LOGIN_FAILED');
    let claims: oidc.IDToken | undefined;
    try {
      const tokens = await oidc.authorizationCodeGrant(
        this.client,
        new URL(req.originalUrl, this.config.publicOrigin),
        {
          pkceCodeVerifier: login.verifier,
          expectedState: login.state,
          expectedNonce: login.nonce,
          idTokenExpected: true,
        },
      );
      claims = tokens.claims();
      if (!claims || !claims.sub || !claims.exp) throw new Error();
    } catch {
      throw new ApiError(401, 'OIDC_LOGIN_FAILED');
    }
    const result = await this.pool.query<{ id: string }>(
      'SELECT p.id FROM principals p JOIN oidc_identities i ON i.principal_id=p.id WHERE i.issuer=$1 AND i.subject=$2 AND p.kind=$3 AND NOT p.disabled',
      [this.config.issuer, claims.sub, 'HUMAN'],
    );
    const principal = result.rows[0];
    if (!principal) throw new ApiError(403, 'IDENTITY_NOT_PROVISIONED');
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    const expiresAt = Math.min(claims.exp * 1000, Date.now() + 15 * 60 * 1000);
    req.session.identity = {
      principalId: principal.id,
      issuer: this.config.issuer,
      subject: claims.sub,
      expiresAt,
    };
    req.session.csrfToken = randomBytes(32).toString('hex');
    req.session.cookie.maxAge = Math.max(0, expiresAt - Date.now());
    await save(req);
    res.redirect('/');
  }
  async authenticate(req: ApiRequest, audience = 'acc-api'): Promise<AuthenticatedIdentity> {
    const header = req.get('authorization');
    if (header) {
      if (!/^Bearer [^\s]+$/u.test(header)) throw new ApiError(401, 'INVALID_TOKEN');
      let subject: string, scopes: string[];
      try {
        const { payload } = await jwtVerify(header.slice(7), this.jwks, {
          issuer: this.config.issuer,
          audience,
          algorithms: ['RS256'],
          requiredClaims: ['sub', 'exp', 'iat'],
          maxTokenAge: '10m',
          clockTolerance: 5,
        });
        subject = payload.sub!;
        scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
      } catch {
        throw new ApiError(401, 'INVALID_TOKEN');
      }
      const found = await this.pool.query<{ id: string }>(
        'SELECT p.id FROM principals p JOIN oidc_identities i ON i.principal_id=p.id WHERE i.issuer=$1 AND i.subject=$2 AND p.kind=$3 AND NOT p.disabled',
        [this.config.issuer, subject, 'AGENT'],
      );
      if (!found.rows[0]) throw new ApiError(401, 'INVALID_TOKEN');
      return { id: found.rows[0].id, kind: 'AGENT', mode: 'BEARER', scopes };
    }
    const identity = req.session.identity;
    if (!identity || identity.issuer !== this.config.issuer || identity.expiresAt <= Date.now())
      throw new ApiError(401, 'AUTH_REQUIRED');
    const principal = await this.pool.query<{ id: string }>(
      'SELECT p.id FROM principals p JOIN oidc_identities i ON i.principal_id=p.id WHERE p.id=$1 AND i.issuer=$2 AND i.subject=$3 AND p.kind=$4 AND NOT p.disabled',
      [identity.principalId, identity.issuer, identity.subject, 'HUMAN'],
    );
    if (!principal.rows[0]) throw new ApiError(401, 'AUTH_REQUIRED');
    return { id: principal.rows[0].id, kind: 'HUMAN', mode: 'COOKIE', scopes: [] };
  }
  verifyCsrf(req: ApiRequest) {
    const supplied = req.get('x-csrf-token') ?? '',
      expected = req.session.csrfToken ?? '';
    const suppliedBytes = Buffer.from(supplied),
      expectedBytes = Buffer.from(expected);
    if (
      req.get('origin') !== this.config.publicOrigin ||
      !expected ||
      suppliedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(suppliedBytes, expectedBytes)
    )
      throw new ApiError(403, 'CSRF_INVALID');
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
