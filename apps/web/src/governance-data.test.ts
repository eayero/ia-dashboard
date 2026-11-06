import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortQuestions } from './governance-data.ts';
test('inbox puts critical questions first without mutating the source', () => {
  const source = [
    { priority: 'NORMAL', publicId: 'Q-1' },
    { priority: 'CRITICAL', publicId: 'Q-2' },
    { priority: 'HIGH', publicId: 'Q-3' },
  ];
  assert.deepEqual(
    sortQuestions(source).map((q) => q.publicId),
    ['Q-2', 'Q-3', 'Q-1'],
  );
  assert.equal(source[0]!.publicId, 'Q-1');
});
