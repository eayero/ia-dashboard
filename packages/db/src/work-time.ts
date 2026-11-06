import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { DomainError } from '@acc/domain';
import type { CommandContext } from './index.ts';

type LeaseInput = { sessionId: string; fencingToken: string };
export async function startWorkInterval(
  client: pg.PoolClient,
  context: CommandContext,
  taskId: string,
  workRevision: number,
  input: LeaseInput,
) {
  await client.query(
    "UPDATE task_work_intervals SET ended_at=valid_until,close_reason='LEASE_EXPIRED' WHERE project_id=$1 AND principal_id=$2 AND ended_at IS NULL AND valid_until<=clock_timestamp()",
    [context.projectId, context.principalId],
  );
  const existing = await client.query(
    'SELECT id FROM task_work_intervals WHERE project_id=$1 AND principal_id=$2 AND ended_at IS NULL',
    [context.projectId, context.principalId],
  );
  if (existing.rowCount) throw new DomainError('WORK_ALREADY_RUNNING');
  const id = randomUUID();
  const result = await client.query<{ id: string; startedAt: Date; validUntil: Date }>(
    `INSERT INTO task_work_intervals(id,project_id,task_id,principal_id,session_id,fencing_token,work_revision,agent_name,owner_user_id,started_at,valid_until,requirement_id,sprint_id)
    SELECT $1,$2,$3,$4,$5,$6,$7,a.name,a.owner_user_id,clock_timestamp()::timestamptz(3),LEAST(c.expires_at,s.expires_at)::timestamptz(3),w.primary_requirement_id,r.sprint_id
    FROM agent_profiles a JOIN task_claims c ON c.principal_id=a.principal_id JOIN agent_sessions s ON s.id=c.session_id JOIN work_items w ON w.project_id=c.project_id AND w.id=c.task_id JOIN requirements r ON r.project_id=w.project_id AND r.id=w.primary_requirement_id
    WHERE a.principal_id=$4 AND c.project_id=$2 AND c.task_id=$3 AND c.session_id=$5 AND c.fencing_token=$6 AND NOT c.revoked AND c.expires_at>clock_timestamp()+interval '1 millisecond' AND s.expires_at>clock_timestamp()+interval '1 millisecond' AND s.ended_at IS NULL
    RETURNING id,started_at AS "startedAt",valid_until AS "validUntil"`,
    [
      id,
      context.projectId,
      taskId,
      context.principalId,
      input.sessionId,
      input.fencingToken,
      workRevision,
    ],
  );
  if (!result.rows[0]) throw new DomainError('STALE_CLAIM');
  return result.rows[0];
}
export async function pauseWorkInterval(
  client: pg.PoolClient,
  context: CommandContext,
  taskId: string,
  input: LeaseInput,
) {
  const result = await client.query<{ id: string; endedAt: Date }>(
    'UPDATE task_work_intervals SET ended_at=GREATEST(started_at,LEAST(clock_timestamp()::timestamptz(3),valid_until)),close_reason=\'PAUSED\' WHERE project_id=$1 AND task_id=$2 AND principal_id=$3 AND session_id=$4 AND fencing_token=$5 AND ended_at IS NULL AND valid_until>clock_timestamp() RETURNING id,ended_at AS "endedAt"',
    [context.projectId, taskId, context.principalId, input.sessionId, input.fencingToken],
  );
  if (!result.rows[0]) throw new DomainError('WORK_NOT_RUNNING');
  return result.rows[0];
}
export async function readTaskWorkTime(
  client: pg.PoolClient,
  projectId: string,
  taskId: string,
  timeZone: string,
) {
  const asOf = (
    await client.query<{ now: Date }>('SELECT clock_timestamp()::timestamptz(3) AS now')
  ).rows[0]!.now;
  const parameters = [projectId, taskId, asOf.toISOString(), timeZone];
  const intervals = await client.query<{
    id: string;
    principalId: string;
    agentName: string;
    ownerUserId: string;
    sessionId: string;
    workRevision: number;
    startedAt: Date;
    endedAt: Date | null;
    effectiveEnd: Date;
    validUntil: Date;
    milliseconds: string;
    state: 'RUNNING' | 'CLOSED' | 'EXPIRED';
    closeReason: string | null;
  }>(
    `SELECT id,principal_id AS "principalId",agent_name AS "agentName",owner_user_id AS "ownerUserId",session_id AS "sessionId",work_revision AS "workRevision",started_at AS "startedAt",ended_at AS "endedAt",valid_until AS "validUntil",GREATEST(started_at,LEAST(COALESCE(ended_at,$3::timestamptz),valid_until,$3::timestamptz)) AS "effectiveEnd",(EXTRACT(EPOCH FROM (GREATEST(started_at,LEAST(COALESCE(ended_at,$3::timestamptz),valid_until,$3::timestamptz))-started_at))*1000)::bigint::text AS milliseconds,CASE WHEN ended_at IS NOT NULL THEN 'CLOSED' WHEN valid_until<=$3::timestamptz THEN 'EXPIRED' ELSE 'RUNNING' END AS state,CASE WHEN ended_at IS NULL AND valid_until<=$3::timestamptz THEN 'LEASE_EXPIRED' ELSE close_reason END AS "closeReason" FROM task_work_intervals WHERE project_id=$1 AND task_id=$2 ORDER BY started_at,id`,
    parameters.slice(0, 3),
  );
  const days = await client.query<{ date: string; principalId: string; milliseconds: string }>(
    `WITH spans AS (SELECT principal_id,started_at,GREATEST(started_at,LEAST(COALESCE(ended_at,$3::timestamptz),valid_until,$3::timestamptz)) AS finish FROM task_work_intervals WHERE project_id=$1 AND task_id=$2), pieces AS (
    SELECT principal_id,to_char(d.day,'YYYY-MM-DD') AS date, GREATEST(0,EXTRACT(EPOCH FROM (LEAST(finish,(d.day+interval '1 day') AT TIME ZONE $4)-GREATEST(started_at,d.day AT TIME ZONE $4)))*1000)::bigint AS milliseconds
    FROM spans CROSS JOIN LATERAL generate_series((started_at AT TIME ZONE $4)::date::timestamp,(finish AT TIME ZONE $4)::date::timestamp,interval '1 day') AS d(day)
  ) SELECT date,principal_id AS "principalId",sum(milliseconds)::bigint::text AS milliseconds FROM pieces GROUP BY date,principal_id HAVING sum(milliseconds)>0 ORDER BY date,principal_id`,
    parameters,
  );
  const agents = new Map<
    string,
    { principalId: string; agentName: string; ownerUserId: string; milliseconds: bigint }
  >();
  let total = 0n;
  for (const interval of intervals.rows) {
    const value = BigInt(interval.milliseconds);
    total += value;
    const prior = agents.get(interval.principalId);
    agents.set(interval.principalId, {
      principalId: interval.principalId,
      agentName: interval.agentName,
      ownerUserId: interval.ownerUserId,
      milliseconds: (prior?.milliseconds ?? 0n) + value,
    });
  }
  return {
    asOf: asOf.toISOString(),
    timeZone,
    totalMilliseconds: total.toString(),
    agents: [...agents.values()].map((a) => ({ ...a, milliseconds: a.milliseconds.toString() })),
    days: days.rows.map((d) => ({
      ...d,
      agentName: agents.get(d.principalId)!.agentName,
      ownerUserId: agents.get(d.principalId)!.ownerUserId,
    })),
    intervals: intervals.rows.map((i) => ({
      ...i,
      startedAt: i.startedAt.toISOString(),
      endedAt: i.endedAt?.toISOString() ?? null,
      effectiveEnd: i.effectiveEnd.toISOString(),
      validUntil: i.validUntil.toISOString(),
    })),
  };
}
