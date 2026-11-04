import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  agentCredentialSchema,
  createUserSchema,
  membershipSchema,
  resetPasswordSchema,
  userStatusSchema,
} from '@acc/contracts';
import { z } from 'zod';
import { ApiError } from '../common/errors.ts';
import type { AuthenticatedIdentity } from './types.ts';
import { hashPassword } from './password.ts';
import { issueCredential } from './credentials.ts';

export class AccountAdministration {
  constructor(private pool: pg.Pool) {}
  private async run<T>(
    actor: AuthenticatedIdentity,
    operation: (db: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    if (
      actor.mode !== 'COOKIE' ||
      actor.user?.systemRole !== 'ADMIN' ||
      actor.user.mustChangePassword
    )
      throw new ApiError(403, 'FORBIDDEN');
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout='5s'");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('acc:account-admin',0))");
      const access = await db.query(
        "SELECT u.principal_id FROM local_users u JOIN principals p ON p.id=u.principal_id WHERE u.principal_id=$1 AND u.system_role='ADMIN' AND NOT p.disabled AND u.credential_version=$2 FOR SHARE OF u,p",
        [actor.id, actor.user.credentialVersion],
      );
      if (!access.rowCount) throw new ApiError(403, 'FORBIDDEN');
      const result = await operation(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === '23505') throw new ApiError(409, 'USERNAME_TAKEN');
        if (error.code === '55P03') throw new ApiError(409, 'REQUEST_IN_PROGRESS');
      }
      throw error;
    } finally {
      db.release();
    }
  }
  private async security(
    db: pg.PoolClient,
    actor: string,
    target: string,
    action: string,
    projectId?: string,
  ) {
    await db.query(
      'INSERT INTO security_events(id,actor_id,target_id,action,project_id) VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), actor, target, action, projectId ?? null],
    );
  }
  private async graph(db: pg.PoolClient, projectId: string) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `acc:graph:${projectId}`,
    ]);
  }
  private async event(
    db: pg.PoolClient,
    projectId: string,
    actor: string,
    target: string,
    action: string,
    payload: unknown,
  ) {
    const seq = (
      await db.query<{ value: string }>(
        "INSERT INTO project_counters(project_id,kind,value) VALUES ($1,'EVENT',1) ON CONFLICT(project_id,kind) DO UPDATE SET value=project_counters.value+1 RETURNING value",
        [projectId],
      )
    ).rows[0]!.value;
    const id = randomUUID();
    await db.query(
      "INSERT INTO audit_events(id,project_id,seq,actor_id,entity_id,entity_type,action,payload,trace_id) VALUES ($1,$2,$3,$4,$5,'PRINCIPAL',$6,$7,$8)",
      [id, projectId, seq, actor, target, action, JSON.stringify(payload), randomUUID()],
    );
    await db.query('INSERT INTO event_outbox(event_id) VALUES ($1)', [id]);
    await this.security(db, actor, target, action, projectId);
  }
  private async invalidateClaims(
    db: pg.PoolClient,
    principalId: string,
    projectId?: string,
    endSessions = false,
  ) {
    if (endSessions)
      await db.query(
        'UPDATE agent_sessions SET ended_at=clock_timestamp(),version=version+1 WHERE principal_id=$1 AND ended_at IS NULL AND ($2::uuid IS NULL OR project_id=$2)',
        [principalId, projectId ?? null],
      );
    await db.query(
      `WITH revoked AS (UPDATE task_claims SET revoked=true,fencing_token=fencing_token+1 WHERE principal_id=$1 AND NOT revoked AND ($2::uuid IS NULL OR project_id=$2) RETURNING task_id) UPDATE work_items SET version=version+1 WHERE id IN (SELECT task_id FROM revoked)`,
      [principalId, projectId ?? null],
    );
  }
  async users(actor: AuthenticatedIdentity) {
    return this.run(actor, async (db) => {
      const users =
        await db.query(`SELECT p.id,u.username,u.display_name AS "displayName",u.system_role AS "systemRole",u.must_change_password AS "mustChangePassword",p.disabled,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',j.id,'name',j.name,'roles',m.roles,'active',m.active,'version',m.version) ORDER BY j.name) FROM project_members m JOIN projects j ON j.id=m.project_id WHERE m.principal_id=p.id),'[]') AS projects
        FROM local_users u JOIN principals p ON p.id=u.principal_id ORDER BY u.username`);
      const projects = await db.query('SELECT id,name,archived FROM projects ORDER BY name,id');
      return { users: users.rows, projects: projects.rows };
    });
  }
  async createUser(actor: AuthenticatedIdentity, body: unknown) {
    if (actor.user?.systemRole !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN');
    const input = createUserSchema.parse(body);
    const hash = await hashPassword(input.password);
    return this.run(actor, async (db) => {
      const id = randomUUID();
      await db.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN')", [id]);
      await db.query(
        'INSERT INTO local_users(principal_id,username,display_name,password_hash,system_role) VALUES ($1,$2,$3,$4,$5)',
        [id, input.username, input.displayName, hash, input.systemRole],
      );
      await this.security(db, actor.id, id, 'USER_CREATED');
      return {
        id,
        username: input.username,
        displayName: input.displayName,
        systemRole: input.systemRole,
        mustChangePassword: true,
      };
    });
  }
  async resetPassword(actor: AuthenticatedIdentity, userId: string, body: unknown) {
    z.uuid().parse(userId);
    if (actor.user?.systemRole !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN');
    if (userId === actor.id) throw new ApiError(409, 'USE_PASSWORD_CHANGE');
    const input = resetPasswordSchema.parse(body);
    const hash = await hashPassword(input.password);
    return this.run(actor, async (db) => {
      const changed = await db.query(
        'UPDATE local_users SET password_hash=$1,credential_version=credential_version+1,must_change_password=true WHERE principal_id=$2 RETURNING principal_id',
        [hash, userId],
      );
      if (!changed.rowCount) throw new ApiError(404, 'USER_NOT_FOUND');
      await this.security(db, actor.id, userId, 'PASSWORD_RESET');
      return { reset: true };
    });
  }
  async status(actor: AuthenticatedIdentity, userId: string, body: unknown) {
    z.uuid().parse(userId);
    const input = userStatusSchema.parse(body);
    if (userId === actor.id && input.disabled) throw new ApiError(409, 'CANNOT_DISABLE_SELF');
    return this.run(actor, async (db) => {
      const projects = (
        await db.query<{ project_id: string }>(
          'SELECT project_id FROM project_members WHERE principal_id=$1 ORDER BY project_id',
          [userId],
        )
      ).rows;
      for (const project of projects) await this.graph(db, project.project_id);
      const user = (
        await db.query<{ system_role: string }>(
          'SELECT system_role FROM local_users WHERE principal_id=$1',
          [userId],
        )
      ).rows[0];
      if (!user) throw new ApiError(404, 'USER_NOT_FOUND');
      if (input.disabled)
        for (const project of projects) {
          const lastOwner = await db.query(
            "SELECT 1 FROM project_members m WHERE m.project_id=$1 AND m.principal_id=$2 AND m.active AND 'OWNER'=ANY(m.roles) AND NOT EXISTS(SELECT 1 FROM project_members o JOIN principals p ON p.id=o.principal_id WHERE o.project_id=m.project_id AND o.principal_id<>m.principal_id AND o.active AND NOT p.disabled AND 'OWNER'=ANY(o.roles))",
            [project.project_id, userId],
          );
          if (lastOwner.rowCount) throw new ApiError(409, 'LAST_PROJECT_OWNER');
        }
      if (input.disabled && user.system_role === 'ADMIN') {
        const others = await db.query(
          "SELECT 1 FROM local_users u JOIN principals p ON p.id=u.principal_id WHERE u.system_role='ADMIN' AND NOT p.disabled AND u.principal_id<>$1",
          [userId],
        );
        if (!others.rowCount) throw new ApiError(409, 'LAST_SYSTEM_ADMIN');
      }
      await db.query('UPDATE principals SET disabled=$1 WHERE id=$2', [input.disabled, userId]);
      await db.query(
        'UPDATE local_users SET credential_version=credential_version+1 WHERE principal_id=$1',
        [userId],
      );
      if (input.disabled) await this.invalidateClaims(db, userId, undefined, true);
      for (const project of projects)
        await this.event(
          db,
          project.project_id,
          actor.id,
          userId,
          input.disabled ? 'principal.disabled' : 'principal.enabled',
          { disabled: input.disabled },
        );
      await this.security(db, actor.id, userId, input.disabled ? 'USER_DISABLED' : 'USER_ENABLED');
      return { id: userId, disabled: input.disabled };
    });
  }
  async membership(actor: AuthenticatedIdentity, userId: string, projectId: string, body: unknown) {
    z.uuid().parse(userId);
    z.uuid().parse(projectId);
    const input = membershipSchema.parse(body);
    return this.run(actor, async (db) => {
      await this.graph(db, projectId);
      if (!(await db.query('SELECT 1 FROM local_users WHERE principal_id=$1', [userId])).rowCount)
        throw new ApiError(404, 'USER_NOT_FOUND');
      if (!(await db.query('SELECT 1 FROM projects WHERE id=$1', [projectId])).rowCount)
        throw new ApiError(404, 'PROJECT_NOT_FOUND');
      const previous = (
        await db.query<{ roles: string[]; active: boolean; version: number }>(
          'SELECT roles,active,version FROM project_members WHERE project_id=$1 AND principal_id=$2 FOR UPDATE',
          [projectId, userId],
        )
      ).rows[0];
      if ((previous?.version ?? 0) !== input.expectedVersion)
        throw new ApiError(409, 'VERSION_CONFLICT');
      if (
        previous?.active &&
        previous.roles.includes('OWNER') &&
        (!input.active || !input.roles.includes('OWNER'))
      ) {
        const other = await db.query(
          "SELECT 1 FROM project_members m JOIN principals p ON p.id=m.principal_id WHERE m.project_id=$1 AND m.principal_id<>$2 AND m.active AND NOT p.disabled AND 'OWNER'=ANY(m.roles)",
          [projectId, userId],
        );
        if (!other.rowCount) throw new ApiError(409, 'LAST_PROJECT_OWNER');
      }
      const row = (
        await db.query<{ version: number }>(
          'INSERT INTO project_members(project_id,principal_id,roles,active) VALUES ($1,$2,$3,$4) ON CONFLICT(project_id,principal_id) DO UPDATE SET roles=$3,active=$4,version=project_members.version+1 RETURNING version',
          [projectId, userId, input.roles, input.active],
        )
      ).rows[0]!;
      await this.invalidateClaims(db, userId, projectId, !input.active);
      await this.event(db, projectId, actor.id, userId, 'member.changed', {
        roles: input.roles,
        active: input.active,
        version: row.version,
      });
      return { projectId, principalId: userId, ...input, version: row.version };
    });
  }
  async agents(actor: AuthenticatedIdentity) {
    return this.run(
      actor,
      async (db) =>
        (
          await db.query(`SELECT c.id,c.principal_id AS "principalId",c.label,c.scopes,c.audiences,c.expires_at AS "expiresAt",c.revoked_at AS "revokedAt",p.disabled,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',j.id,'name',j.name,'active',m.active)) FROM project_members m JOIN projects j ON j.id=m.project_id WHERE m.principal_id=c.principal_id),'[]') AS projects
      FROM agent_credentials c JOIN principals p ON p.id=c.principal_id ORDER BY c.created_at DESC,c.id`)
        ).rows,
    );
  }
  async createAgent(actor: AuthenticatedIdentity, body: unknown) {
    const input = agentCredentialSchema.parse(body);
    return this.run(actor, async (db) => {
      await this.graph(db, input.projectId);
      if (
        !(await db.query('SELECT 1 FROM projects WHERE id=$1 AND NOT archived', [input.projectId]))
          .rowCount
      )
        throw new ApiError(404, 'PROJECT_NOT_FOUND');
      const id = randomUUID();
      await db.query("INSERT INTO principals(id,kind) VALUES ($1,'AGENT')", [id]);
      await db.query(
        'INSERT INTO project_members(project_id,principal_id,scopes) VALUES ($1,$2,$3)',
        [input.projectId, id, input.scopes],
      );
      const credential = await issueCredential(
        db,
        id,
        input.label,
        input.scopes,
        input.audiences,
        input.expiresInDays,
      );
      await this.event(db, input.projectId, actor.id, id, 'credential.created', {
        credentialId: credential.id,
        label: input.label,
      });
      return credential;
    });
  }
  async revokeCredential(actor: AuthenticatedIdentity, id: string) {
    z.uuid().parse(id);
    return this.run(actor, async (db) => {
      const row = (
        await db.query<{ principal_id: string }>(
          'SELECT principal_id FROM agent_credentials WHERE id=$1',
          [id],
        )
      ).rows[0];
      if (!row) throw new ApiError(404, 'CREDENTIAL_NOT_FOUND');
      const projects = (
        await db.query<{ project_id: string }>(
          'SELECT project_id FROM project_members WHERE principal_id=$1 ORDER BY project_id',
          [row.principal_id],
        )
      ).rows;
      for (const project of projects) await this.graph(db, project.project_id);
      await db.query(
        'UPDATE agent_credentials SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1',
        [id],
      );
      await this.invalidateClaims(db, row.principal_id, undefined, true);
      for (const project of projects)
        await this.event(db, project.project_id, actor.id, row.principal_id, 'credential.revoked', {
          credentialId: id,
        });
      return { revoked: true };
    });
  }
}
