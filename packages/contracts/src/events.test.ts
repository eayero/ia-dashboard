import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as contracts from './index.ts';

test('secuencias se conservan como decimal exacto y rechazan coerción o overflow', () => {
  assert.equal(contracts.sequenceSchema.parse('9007199254740993'), '9007199254740993');
  for (const value of [1, '01', '-1', 'abc', '9223372036854775808'])
    assert.equal(contracts.sequenceSchema.safeParse(value).success, false);
});
test('consultas de contexto y delta acotan páginas y excluyen cursores ambiguos', () => {
  assert.equal(contracts.contextQuerySchema.safeParse({ limit: '100' }).success, true);
  for (const query of [{ limit: '101' }, { limit: ['20'] }, { extra: 'x' }])
    assert.equal(contracts.contextQuerySchema.safeParse(query).success, false);
  assert.equal(contracts.eventsQuerySchema.safeParse({ afterSeq: '0', limit: '20' }).success, true);
  assert.equal(
    contracts.eventsQuerySchema.safeParse({ afterSeq: '1', cursor: 'x' }).success,
    false,
  );
});
test('envelope compartido conserva identidad, secuencia y versión de esquema', () => {
  const id = '7f5481cc-9ab3-4e07-a481-cfb8a38f429d';
  const event = {
    eventId: id,
    projectId: id,
    seq: '9007199254740993',
    schemaVersion: 1,
    type: 'task.created',
    occurredAt: '2026-11-03T10:00:00.000Z',
    entity: { id, type: 'TASK' },
    actorId: id,
    sessionId: null,
    traceId: id,
    payload: { version: 1 },
  };
  assert.equal(contracts.eventEnvelopeSchema.parse(event).seq, '9007199254740993');
  for (const extra of [{ seq: '0' }, { seq: 1 }, { schemaVersion: 2 }, { type: '' }])
    assert.equal(contracts.eventEnvelopeSchema.safeParse({ ...event, ...extra }).success, false);
});
