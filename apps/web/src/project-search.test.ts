import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as route from './project-search.ts';
test('enlace directo de requisito valida UUID y conserva su vista', () => {
  assert.equal(typeof route.parseProjectSearch, 'function');
  const id = 'd001e794-fc3e-4b42-86a6-60a45d413180';
  assert.deepEqual(
    route.parseProjectSearch({ projectId: id, requirementId: id, view: 'requirements' }),
    { projectId: id, requirementId: id, view: 'requirements' },
  );
  assert.deepEqual(route.parseProjectSearch({ requirementId: '<script>', view: 'unknown' }), {});
});
