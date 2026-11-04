import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as contracts from './index.ts';

test('requisitos normalizan contenido y rechazan procedencia inyectada', () => {
  assert.ok('createRequirementSchema' in contracts, 'requirement contracts must exist');
  const schema = contracts.createRequirementSchema;
  const value = { title: '  Acceso   seguro ', description: 'Descripción', type: 'FUNCTIONAL' };
  assert.equal(schema.parse(value).title, 'Acceso seguro');
  assert.equal(schema.safeParse({ ...value, approvedBy: 'self' }).success, false);
  assert.equal(schema.safeParse({ ...value, title: ' ' }).success, false);
  assert.equal(schema.safeParse({ ...value, type: 'OTHER' }).success, false);
});

test('revisiones y evaluación exigen versiones, revisión exacta y motivo', () => {
  assert.ok('evaluateRequirementImpactSchema' in contracts);
  const schema = contracts.evaluateRequirementImpactSchema;
  const value = {
    expectedVersion: 1,
    taskId: '35dea5c2-8bcf-40b3-a7c0-76cabe089a6e',
    taskVersion: 1,
    revision: 1,
    reason: 'Evaluado',
  };
  assert.equal(schema.safeParse(value).success, true);
  for (const invalid of [
    { revision: 0 },
    { taskVersion: 0 },
    { reason: '' },
    { actorId: value.taskId },
  ]) {
    assert.equal(schema.safeParse({ ...value, ...invalid }).success, false);
  }
});
