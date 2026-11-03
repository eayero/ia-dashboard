import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSnapshot, type SnapshotPage } from './data.ts';

const first: SnapshotPage = {
  projectId: 'project',
  snapshotId: 'snapshot',
  projectSeq: '9007199254740993',
  generatedAt: '2026-11-03T12:00:00Z',
  expiresAt: '2026-11-03T12:10:00Z',
  records: [{ entityType: 'TASK', data: { id: 'task-a' } }],
  complete: false,
  nextCursor: 'second',
  changesCursor: null,
};
test('dashboard conserva todas las páginas de una única secuencia exacta antes de habilitar cambios', async () => {
  const result = await collectSnapshot(async (cursor) =>
    cursor
      ? {
          ...first,
          records: [{ entityType: 'TASK', data: { id: 'task-b' } }],
          complete: true,
          nextCursor: null,
          changesCursor: 'delta',
        }
      : first,
  );
  assert.equal(result.projectSeq, '9007199254740993');
  assert.deepEqual(
    result.records.map((record) => record.data.id),
    ['task-a', 'task-b'],
  );
  assert.equal(result.changesCursor, 'delta');
});
test('dashboard rechaza páginas mezcladas, incompletas o cursores cíclicos', async () => {
  for (const changed of [
    { ...first, snapshotId: 'another', complete: true, nextCursor: null, changesCursor: 'delta' },
    {
      ...first,
      projectSeq: '9007199254740994',
      complete: true,
      nextCursor: null,
      changesCursor: 'delta',
    },
    { ...first, complete: true, nextCursor: null, changesCursor: null },
    first,
  ])
    await assert.rejects(
      collectSnapshot(async (cursor) => (cursor ? changed : first)),
      /CONTEXT_INCONSISTENT/u,
    );
});
