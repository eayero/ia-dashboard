import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as contracts from './index.ts';
test('inicio/pausa requieren sesión, fencing y versión sin aceptar tiempos o agentes elegidos', () => {
  assert.ok('startWorkSchema' in contracts);
  const value = {
    expectedVersion: 1,
    sessionId: 'd001e794-fc3e-4b42-86a6-60a45d413180',
    fencingToken: '1',
  };
  assert.ok(contracts.startWorkSchema.safeParse(value).success);
  for (const extra of [
    { duration: 3600 },
    { principalId: value.sessionId },
    { startedAt: '2026-01-01' },
  ])
    assert.equal(contracts.startWorkSchema.safeParse({ ...value, ...extra }).success, false);
});
test('consulta de tiempo valida zona IANA y rechaza campos desconocidos', () => {
  assert.ok('taskTimeQuerySchema' in contracts);
  assert.equal(contracts.taskTimeQuerySchema.parse({}).timeZone, 'America/Caracas');
  assert.ok(contracts.taskTimeQuerySchema.safeParse({ timeZone: 'UTC' }).success);
  assert.equal(contracts.taskTimeQuerySchema.safeParse({ timeZone: 'Mars/Base' }).success, false);
});
