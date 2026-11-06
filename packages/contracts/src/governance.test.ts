import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as contracts from './index.ts';

test('governance contracts reject actor injection and require explicit confirmation/version', () => {
  assert.ok('createQuestionSchema' in contracts);
  const question = { title: 'Question', description: 'Context', priority: 'CRITICAL' };
  assert.equal(contracts.createQuestionSchema.safeParse(question).success, true);
  assert.equal(
    contracts.createQuestionSchema.safeParse({ ...question, actorId: randomUUID() }).success,
    false,
  );
  assert.equal(
    contracts.resolveQuestionSchema.safeParse({
      expectedVersion: 1,
      answerId: randomUUID(),
      reason: 'Confirm',
    }).success,
    true,
  );
  assert.equal(
    contracts.resolveQuestionSchema.safeParse({ answerId: randomUUID() }).success,
    false,
  );
});

test('decision alternatives are distinct and the choice must be one of them', () => {
  assert.ok('createDecisionSchema' in contracts);
  const decision = {
    title: 'Decision',
    context: 'Context',
    alternatives: ['Option A', 'Option B'],
    choice: 'Option A',
    rationale: 'Reason',
  };
  assert.equal(contracts.createDecisionSchema.safeParse(decision).success, true);
  for (const invalid of [
    { alternatives: ['Only'] },
    { alternatives: ['Same', ' Same '] },
    { choice: 'Absent' },
    { approvedBy: randomUUID() },
  ])
    assert.equal(
      contracts.createDecisionSchema.safeParse({ ...decision, ...invalid }).success,
      false,
    );
});
