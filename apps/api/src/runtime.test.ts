import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('exports de workspace DB cargan en Node nativo usado por la API compilada', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', "await import('./packages/db/src/index.ts')"],
    { cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(result.status, 0, result.stderr);
});
