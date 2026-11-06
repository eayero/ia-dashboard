import type pg from 'pg';
import { DomainError } from '@acc/domain';
type Identity = {
  principalId: string;
  kind: 'HUMAN' | 'AGENT';
  agentName: string | null;
  username: string | null;
  ownerUserId: string | null;
  ownerUsername: string | null;
};
type Participation = {
  principalId: string;
  identity: Identity | null;
  firstAt: string | null;
  lastAt: string | null;
  actionCount: number;
  channels: string[];
  milliseconds: string;
};
export async function readEntityAttribution(
  client: pg.PoolClient,
  projectId: string,
  entityId: string,
  entityType: 'TASK' | 'REQUIREMENT',
  timeZone: string,
) {
  const table = entityType === 'TASK' ? 'work_items' : 'requirements';
  const found = (
    await client.query<{ created_by: string; created_at: Date; creator_identity: Identity | null }>(
      `SELECT created_by,created_at,creator_identity FROM ${table} WHERE project_id=$1 AND id=$2`,
      [projectId, entityId],
    )
  ).rows[0];
  if (!found)
    throw new DomainError(entityType === 'TASK' ? 'TASK_NOT_FOUND' : 'REQUIREMENT_NOT_FOUND');
  const events = (
    await client.query<{
      actor_id: string;
      actor_identity: Identity | null;
      occurred_at: Date;
      channel: string;
      action: string;
    }>(
      'SELECT actor_id,actor_identity,occurred_at,channel,action FROM audit_events WHERE project_id=$1 AND entity_id=$2 AND entity_type=$3 ORDER BY seq',
      [projectId, entityId, entityType],
    )
  ).rows;
  const participants = new Map<string, Participation>();
  for (const e of events) {
    let p = participants.get(e.actor_id);
    if (!p) {
      p = {
        principalId: e.actor_id,
        identity: e.actor_identity,
        firstAt: e.occurred_at.toISOString(),
        lastAt: e.occurred_at.toISOString(),
        actionCount: 0,
        channels: [],
        milliseconds: '0',
      };
      participants.set(e.actor_id, p);
    }
    // A later authenticated action can identify a participant whose older
    // events predate provenance, without modifying any historical event.
    p.identity ??= e.actor_identity;
    p.actionCount++;
    p.lastAt = e.occurred_at.toISOString();
    if (!p.channels.includes(e.channel)) p.channels.push(e.channel);
  }
  const asOf = (
    await client.query<{ now: Date }>('SELECT clock_timestamp()::timestamptz(3) AS now')
  ).rows[0]!.now;
  const column = entityType === 'TASK' ? 'task_id' : 'requirement_id';
  const spans = (
    await client.query<{
      principalId: string;
      agentName: string;
      ownerUserId: string;
      taskId: string;
      requirementId: string | null;
      sprintId: string | null;
      milliseconds: string;
    }>(
      `SELECT principal_id AS "principalId",agent_name AS "agentName",owner_user_id AS "ownerUserId",task_id AS "taskId",requirement_id AS "requirementId",sprint_id AS "sprintId",sum((EXTRACT(EPOCH FROM (GREATEST(started_at,LEAST(COALESCE(ended_at,$3::timestamptz),valid_until,$3::timestamptz))-started_at))*1000)::bigint)::text AS milliseconds FROM task_work_intervals WHERE project_id=$1 AND ${column}=$2 GROUP BY principal_id,agent_name,owner_user_id,task_id,requirement_id,sprint_id ORDER BY task_id,principal_id`,
      [projectId, entityId, asOf],
    )
  ).rows;
  const collaborators = new Map<string, Participation>();
  const owners = new Map<string, bigint>();
  let total = 0n;
  for (const span of spans) {
    const ms = BigInt(span.milliseconds);
    total += ms;
    owners.set(span.ownerUserId, (owners.get(span.ownerUserId) ?? 0n) + ms);
    const dest = entityType === 'TASK' ? participants : collaborators;
    let p = dest.get(span.principalId);
    if (!p) {
      p = {
        principalId: span.principalId,
        identity: {
          principalId: span.principalId,
          kind: 'AGENT',
          agentName: span.agentName,
          username: null,
          ownerUserId: span.ownerUserId,
          ownerUsername: null,
        },
        firstAt: null,
        lastAt: null,
        actionCount: 0,
        channels: [],
        milliseconds: '0',
      };
      dest.set(span.principalId, p);
    }
    p.milliseconds = (BigInt(p.milliseconds) + ms).toString();
  }
  if (entityType === 'REQUIREMENT') {
    const taskActors = (
      await client.query<{
        actor_id: string;
        actor_identity: Identity | null;
        occurred_at: Date;
        channel: string;
      }>(
        "SELECT e.actor_id,e.actor_identity,e.occurred_at,e.channel FROM audit_events e JOIN work_items w ON w.project_id=e.project_id AND w.id=e.entity_id WHERE e.project_id=$1 AND e.entity_type='TASK' AND w.primary_requirement_id=$2 ORDER BY e.seq",
        [projectId, entityId],
      )
    ).rows;
    for (const e of taskActors) {
      let p = collaborators.get(e.actor_id);
      if (!p) {
        p = {
          principalId: e.actor_id,
          identity: e.actor_identity,
          firstAt: e.occurred_at.toISOString(),
          lastAt: e.occurred_at.toISOString(),
          actionCount: 0,
          channels: [],
          milliseconds: '0',
        };
        collaborators.set(e.actor_id, p);
      }
      // Interval snapshots know the historic owner ID, but audit snapshots can
      // supply its display name. Only enrich the same owner; never move time to
      // an owner from a later action.
      if (
        e.actor_identity &&
        (!p.identity ||
          (p.actionCount === 0 && p.identity.ownerUserId === e.actor_identity.ownerUserId))
      )
        p.identity = e.actor_identity;
      p.firstAt ??= e.occurred_at.toISOString();
      p.lastAt = e.occurred_at.toISOString();
      p.actionCount++;
      if (!p.channels.includes(e.channel)) p.channels.push(e.channel);
    }
  }
  return {
    creator: {
      principalId: found.created_by,
      createdAt: found.created_at.toISOString(),
      identity: found.creator_identity,
      channel: found.creator_identity
        ? (events.find(
            (e) =>
              e.actor_id === found.created_by &&
              e.action === (entityType === 'TASK' ? 'task.created' : 'requirement.created'),
          )?.channel ?? 'UNKNOWN')
        : 'UNKNOWN',
    },
    participants: [...participants.values()],
    taskCollaborators: [...collaborators.values()],
    owners: [...owners].map(([ownerUserId, ms]) => ({ ownerUserId, milliseconds: ms.toString() })),
    totalMilliseconds: total.toString(),
    asOf: asOf.toISOString(),
    timeZone,
    work: spans,
  };
}
