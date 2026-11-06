import { eventEnvelopeSchema } from '@acc/contracts';
export type AuditEventRow = {
  id: string;
  project_id: string;
  seq: string;
  schema_version: 1;
  action: string;
  occurred_at: Date;
  entity_id: string;
  entity_type:
    | 'TASK'
    | 'SESSION'
    | 'PRINCIPAL'
    | 'REQUIREMENT'
    | 'REPOSITORY'
    | 'ITERATION'
    | 'QUESTION'
    | 'DECISION';
  actor_id: string;
  actor_user_id: string | null;
  session_id: string | null;
  trace_id: string;
  payload: Record<string, unknown>;
};
export function eventFromRow(row: AuditEventRow) {
  const payload = { ...row.payload };
  // Ownership tokens are returned only through owner-specific reads/commands.
  delete payload.fencingToken;
  return eventEnvelopeSchema.parse({
    eventId: row.id,
    projectId: row.project_id,
    seq: row.seq,
    schemaVersion: row.schema_version,
    type: row.action,
    occurredAt: row.occurred_at.toISOString(),
    entity: { id: row.entity_id, type: row.entity_type },
    actorId: row.actor_id,
    actorUserId: row.actor_user_id ?? null,
    sessionId: row.session_id,
    traceId: row.trace_id,
    payload,
  });
}
