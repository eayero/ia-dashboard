import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as contracts from './index.ts';

test('sprints validate states, dates and reject injected identity', () => {
  assert.ok('createIterationSchema' in contracts, 'iteration contracts must exist');
  const schema = contracts.createIterationSchema;
  const input = {
    name: ' Sprint  1 ',
    goal: 'Entrega',
    startsOn: '2026-11-05',
    endsOn: '2026-11-19',
  };
  assert.equal(schema.parse(input).name, 'Sprint 1');
  for (const invalid of [
    { endsOn: '2026-11-01' },
    { startsOn: '2026-02-30' },
    { actorId: randomUUID() },
    { state: 'ACTIVE' },
  ])
    assert.equal(schema.safeParse({ ...input, ...invalid }).success, false);
});
test('task creation requires an explicit linked primary requirement', () => {
  const id = randomUUID(),
    other = randomUUID();
  const input = {
    title: 'Tarea',
    criteria: [{ id: 'c1', description: 'Entrega', required: true }],
    requirementIds: [id],
    primaryRequirementId: id,
  };
  assert.equal(contracts.createTaskSchema.safeParse(input).success, true);
  assert.equal(
    contracts.createTaskSchema.safeParse({ ...input, primaryRequirementId: other }).success,
    false,
  );
  const { primaryRequirementId: _primary, ...missing } = input;
  assert.equal(_primary, id);
  assert.equal(contracts.createTaskSchema.safeParse(missing).success, false);
});
