import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd(),
  read = (file) => readFileSync(file, 'utf8'),
  json = (file) => JSON.parse(read(file));
const config = json('config/project.json');

test('both harness entrypoints reach shared instructions, current sources and every role', () => {
  for (const entry of ['AGENTS.md', 'CLAUDE.md']) {
    assert.match(read(entry), /COMO-TRABAJAMOS\.md/u);
    assert.ok(read(entry).split('\n').length <= 35);
  }
  assert.ok(read('COMO-TRABAJAMOS.md').split('\n').length <= 100);
  for (const file of Object.values(config.documentation)) assert.ok(existsSync(file), file);
  for (const role of config.agents.enabledRoles) {
    assert.ok(existsSync(`agents/roles/${role}.md`));
    assert.ok(existsSync(`agents/generated/${role}.md`));
  }
  assert.match(read('AGENTS.md'), /node scripts\/agents\/setup\.mjs --root \./u);
  assert.match(read('CLAUDE.md'), /AGENTS\.md/u);
});
test('Claude adapters use minimal metadata, canonical profiles and no permission escalation', () => {
  const files = readdirSync('.claude/agents').filter((f) => f.endsWith('.md'));
  assert.equal(files.length, config.agents.enabledRoles.length - 1);
  for (const file of files) {
    const source = read('.claude/agents/' + file),
      role = file.slice(0, -3);
    const frontmatter = /^---\n([\s\S]+?)\n---\n/u.exec(source);
    assert.ok(frontmatter, file);
    const keys = frontmatter[1].split('\n').map((line) => line.split(':')[0]);
    assert.deepEqual(keys, ['name', 'description']);
    assert.match(frontmatter[1], new RegExp('name: ' + role));
    assert.ok(source.includes('agents/generated/' + role + '.md'));
    assert.equal(/bypassPermissions|dangerously-skip|permissionMode:/u.test(source), false);
  }
});
test('project rules preserve ACC autonomy, ownership, state names and scoped authority', () => {
  const source = read('docs/process/PROJECT-RULES.md');
  for (const text of [
    'IN_REVIEW',
    'IN_QA',
    'DONE',
    'READY',
    'usuario',
    'HTTPS',
    'referencia principal',
  ])
    assert.ok(source.includes(text), text);
  assert.equal(config.agents.acc.required, true);
  assert.equal(config.agents.allowDelegationWithoutPerTaskApproval, false);
  assert.equal(config.agents.sharedStateBackend, 'files-primary-with-required-acc-mcp-mirror');
  assert.ok(config.quality.projectTaskStates.includes('IN_QA'));
  assert.ok(!config.quality.projectTaskStates.includes('REVIEW'));
});
test('requirements and decisions retain stable IDs with traceable tasks and existing evidence', () => {
  const trace = json('docs/requirements/TRACEABILITY.json'),
    catalog = json('docs/acc-tasks.json');
  const ids = new Set();
  for (const requirement of trace.requirements) {
    assert.ok(!ids.has(requirement.id));
    ids.add(requirement.id);
    assert.ok(existsSync(requirement.source));
    if (requirement.scope === 'product')
      assert.ok(read('docs/SPECIFICATION.md').includes(requirement.id));
    for (const task of requirement.tasks)
      assert.ok(
        catalog.some((t) => t.id === task.fileId),
        task.fileId,
      );
    for (const decision of requirement.decisions) {
      assert.ok(existsSync(decision.source));
      assert.ok(read(decision.source).includes(decision.id));
    }
    for (const file of requirement.evidence) assert.ok(existsSync(file), file);
  }
  assert.equal(trace.requirements.filter((r) => r.scope === 'product').length, 20);
  assert.equal(catalog.filter((t) => t.id === 'ACC-LOCAL-019').length, 1);
});
test('documentation map stays inside repository and all active Markdown links resolve', () => {
  const map = json('.governance/docs-map.json');
  for (const file of Object.values(map)) {
    const full = path.resolve(file),
      relative = path.relative(root, full);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.ok(existsSync(full), file);
  }
  const files = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'COMO-TRABAJAMOS.md'];
  function collect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (file.replaceAll('\\', '/').includes('/original/')) continue;
      if (entry.isDirectory()) collect(file);
      else if (file.endsWith('.md')) files.push(file);
    }
  }
  for (const dir of ['docs', 'agents', '.claude/agents']) collect(dir);
  for (const file of files) {
    for (const match of read(file).matchAll(/\]\(([^)]+)\)/gu)) {
      let target = match[1].replace(/^<|>$/gu, '').split('#')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue;
      target = decodeURIComponent(target);
      assert.ok(existsSync(path.resolve(path.dirname(file), target)), `${file} -> ${target}`);
    }
  }
});
test('generated profiles are current and availability records do not claim skills were executed', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/agents/setup.mjs', '--root', '.', '--check', '--json'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const detected = JSON.parse(result.stdout);
  assert.equal(
    detected.signals.some((s) => s.file.startsWith('.tools/')),
    false,
  );
  for (const skill of detected.skills) {
    assert.equal(skill.executed, false);
    assert.equal(skill.runtimeRegistration, 'NOT_VERIFIED');
  }
  const inventory = json('docs/process/ECC-INVENTORY.json');
  assert.equal(inventory.installedDuringMigration, false);
  assert.ok(inventory.availableFileCount >= inventory.selected.length);
});
