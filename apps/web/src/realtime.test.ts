import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realtimeHandlers } from './realtime.ts';

const projectId = randomUUID();
function envelope(seq = '9007199254740993') {
  return {
    eventId: randomUUID(),
    projectId,
    seq,
    schemaVersion: 1,
    type: 'task.created',
    occurredAt: new Date().toISOString(),
    entity: { id: randomUUID(), type: 'TASK' },
    actorId: randomUUID(),
    actorUserId: randomUUID(),
    sessionId: null,
    traceId: randomUUID(),
    payload: {},
  };
}
test('WS deduplica eventId sin descartar eventos fuera de orden y conserva secuencias grandes', () => {
  let refreshes = 0;
  const h = realtimeHandlers(
    projectId,
    () => refreshes++,
    () => undefined,
  );
  const first = envelope();
  h.event(first);
  h.event(first);
  h.event(envelope('9007199254740992'));
  assert.equal(refreshes, 2);
  h.event({ ...envelope(), projectId: randomUUID() });
  h.event({ payload: 'invalid' });
  assert.equal(refreshes, 2);
});
test('WS reconexión y resync solicitan REST sin aplicar payloads parciales', () => {
  let refreshes = 0;
  const h = realtimeHandlers(
    projectId,
    () => refreshes++,
    () => undefined,
  );
  h.ready({ projectId });
  h.ready({ projectId });
  h.resync({ projectId });
  h.resync({ projectId: randomUUID() });
  assert.equal(refreshes, 3);
});
test('WS propaga pérdida de acceso y distingue fallos temporales de 401/403', () => {
  const statuses: number[] = [];
  const h = realtimeHandlers(
    projectId,
    () => undefined,
    (status) => statuses.push(status),
  );
  h.denied({ status: 401 });
  h.denied({ status: 403 });
  h.denied({ status: 503 });
  h.denied(null);
  assert.deepEqual(statuses, [401, 403]);
});
