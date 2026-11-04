/** One-time audit of the protocol adoption against its recorded baseline. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const base = 'docs/process/migrations/2026-11-04-ecc';
const baseline = JSON.parse(readFileSync(base + '/BASELINE.json', 'utf8'));
const mutable = new Set([
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'COMO-TRABAJAMOS.md',
  '.prettierignore',
  'docs/acc-tasks.json',
  'docs/ACC_WORK_SYNC.json',
]);
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
let preserved = 0;
for (const [file, expected] of Object.entries(baseline.files))
  if (!mutable.has(file)) {
    assert.ok(existsSync(file), 'Removed baseline file: ' + file);
    assert.equal(hash(file), expected, 'Changed protected file: ' + file);
    preserved++;
  }
for (const name of ['AGENTS.md', 'CLAUDE.md', 'COMO-TRABAJAMOS.md'])
  assert.equal(
    hash(base + '/original/' + name),
    baseline.files[name],
    'Original instructions not preserved',
  );
const manifest = JSON.parse(readFileSync(base + '/TEMPLATE-MANIFEST.json', 'utf8'));
assert.equal(
  hash('docs/process/UNIVERSAL-PROTOCOL.md'),
  manifest.files.find((f) => f.path === 'COMO-TRABAJAMOS.md').sha256,
);
const atBase = (file) =>
  execFileSync('git', ['show', baseline.commit + ':' + file], { encoding: 'utf8' });
const originalCatalog = JSON.parse(atBase('docs/acc-tasks.json')),
  catalog = JSON.parse(readFileSync('docs/acc-tasks.json', 'utf8'));
for (const entry of originalCatalog)
  assert.deepEqual(
    catalog.find((t) => t.id === entry.id),
    entry,
    'Historical task scope changed',
  );
assert.equal(catalog.filter((t) => t.id === 'ACC-LOCAL-019').length, 1);
assert.ok(
  readFileSync('.prettierignore', 'utf8')
    .replaceAll('\r\n', '\n')
    .startsWith(atBase('.prettierignore').replaceAll('\r\n', '\n')),
  'Old formatting exclusions changed',
);
assert.equal(
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  baseline.commit,
  'HEAD changed during migration',
);
assert.equal(
  execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim(),
  '',
  'Index was staged during migration',
);
const config = JSON.parse(readFileSync('config/project.json', 'utf8'));
for (const key of [
  'gitCommit',
  'gitPush',
  'gitMerge',
  'deploy',
  'installDependencies',
  'installSkills',
  'externalActions',
])
  assert.equal(config.permissions[key], false, key);
console.log(
  JSON.stringify({
    protectedBaselineFilesUnchanged: preserved,
    totalBaselineFiles: Object.keys(baseline.files).length,
    originalInstructionsExact: 3,
    universalSourceExact: true,
    oldTaskScopesPreserved: originalCatalog.length,
    noBaselineDeletions: true,
    headUnchanged: true,
    indexUnchanged: true,
    functionalCodeAndArchitectureUnchanged: true,
    scope:
      'One-time adoption audit; do not use this frozen baseline as a future product regression gate.',
  }),
);
