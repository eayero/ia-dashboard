import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const script = path.resolve('scripts/agents/setup.mjs');
test('check detects drift without rewriting and write is idempotent', () =>
  withRepo((root) => {
    run(root, '--write');
    const file = path.join(root, 'agents/generated/developer.md'),
      original = readFileSync(file, 'utf8');
    run(root, '--write');
    assert.equal(readFileSync(file, 'utf8'), original);
    run(root, '--check');
    writeFileSync(file, original + '\nLocal customization\n');
    const result = spawnSync(process.execPath, [script, '--root', root, '--check', '--json'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).stale.includes('agents/generated/developer.md'));
    assert.equal(readFileSync(file, 'utf8'), original + '\nLocal customization\n');
  }));
test('refuses symlink or junction output before writing any profiles', () =>
  withRepo((root) => {
    const protectedDir = path.join(root, 'protected');
    mkdirSync(protectedDir);
    const file = path.join(protectedDir, 'preserve.txt');
    writeFileSync(file, 'Preserve');
    symlinkSync(
      protectedDir,
      path.join(root, '.claude'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const result = spawnSync(process.execPath, [script, '--root', root, '--write'], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(path.join(root, 'agents')), false);
    assert.equal(readFileSync(file, 'utf8'), 'Preserve');
  }));
test('scopes UX profiles to React without assigning backend patterns', () =>
  withRepo((root) => {
    for (const [directory, dependencies] of [
      ['api', { '@nestjs/common': '12' }],
      ['web', { react: '19' }],
    ]) {
      mkdirSync(path.join(root, directory));
      writeFileSync(path.join(root, directory, 'package.json'), JSON.stringify({ dependencies }));
    }
    writeFileSync(
      path.join(root, 'config/project.json'),
      JSON.stringify({
        agents: {
          enabledRoles: ['ux-designer'],
          specialization: { roleProfiles: { 'ux-designer': ['react-web'] } },
        },
      }),
    );
    const result = run(root);
    assert.deepEqual(result.roleProfiles['ux-designer'], ['react-web']);
    assert.equal(result.roleSkills['ux-designer'].includes('backend-patterns'), false);
  }));
function withRepo(fn) {
  const base = path.resolve(os.tmpdir());
  const root = mkdtempSync(path.join(base, 'agent-bootstrap-'));
  try {
    mkdirSync(path.join(root, 'config'));
    writeFileSync(
      path.join(root, 'config/project.json'),
      JSON.stringify({ agents: { enabledRoles: ['developer', 'qa-engineer'] } }),
    );
    fn(root);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), base);
    assert.ok(path.basename(root).startsWith('agent-bootstrap-'));
    rmSync(root, { recursive: true, force: true });
  }
}
function run(root, ...args) {
  const r = spawnSync(process.execPath, [script, '--root', root, '--json', ...args], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
test('read-only discovery does not create files', () =>
  withRepo((root) => {
    writeFileSync(path.join(root, 'pom.xml'), '<dependency>spring-boot-starter-web</dependency>');
    const r = run(root);
    assert.deepEqual(r.detectedProfiles, ['java-spring']);
    assert.equal(existsSync(path.join(root, 'agents')), false);
  }));
test('multi-stack detected, generated, and idempotent without force', () =>
  withRepo((root) => {
    mkdirSync(path.join(root, 'backend'));
    mkdirSync(path.join(root, 'app'));
    writeFileSync(
      path.join(root, 'backend/package.json'),
      JSON.stringify({ dependencies: { '@nestjs/common': '^11' } }),
    );
    writeFileSync(
      path.join(root, 'app/build.gradle.kts'),
      'plugins { id("com.android.application") }',
    );
    const r = run(root, '--write');
    assert.deepEqual(r.detectedProfiles, ['android-kotlin', 'node-nest']);
    assert.ok(existsSync(path.join(root, '.claude/agents/developer.md')));
    const developer = readFileSync(path.join(root, 'agents/generated/developer.md'), 'utf8');
    assert.match(developer, /NestJS/);
    assert.match(developer, /Kotlin/);
    assert.match(developer, /NO ENCONTRADA/);
    const after = run(root, '--write');
    assert.ok(after.skipped.length > 0);
    const force = run(root, '--write', '--force');
    assert.ok(force.generated.length > 0);
  }));
test('never overwrites user-authored adapters even with force', () =>
  withRepo((root) => {
    mkdirSync(path.join(root, '.claude/agents'), { recursive: true });
    const file = path.join(root, '.claude/agents/developer.md');
    writeFileSync(file, 'User custom agent');
    const r = run(root, '--write', '--force');
    assert.equal(readFileSync(file, 'utf8'), 'User custom agent');
    assert.ok(r.skipped.some((x) => x.path.includes('developer')));
  }));

test('excludes tool manifests and detects PostgreSQL, Redis and MCP from application dependencies', () =>
  withRepo((root) => {
    mkdirSync(path.join(root, '.tools'));
    writeFileSync(
      path.join(root, '.tools/package.json'),
      JSON.stringify({ dependencies: { react: '19' } }),
    );
    mkdirSync(path.join(root, 'apps/api'), { recursive: true });
    writeFileSync(
      path.join(root, 'apps/api/package.json'),
      JSON.stringify({
        dependencies: {
          '@nestjs/common': '12',
          pg: '8',
          redis: '6',
          '@modelcontextprotocol/sdk': '1',
        },
      }),
    );
    const r = run(root);
    assert.equal(
      r.signals.some((s) => s.file.startsWith('.tools/')),
      false,
    );
    for (const name of ['node-nest', 'postgresql', 'redis-events', 'mcp-server'])
      assert.ok(r.detectedProfiles.includes(name), name);
    assert.equal(r.detectedProfiles.includes('react-web'), false);
  }));

test('reports missing skills directly and resolves configured ECC plugin cache without installation', () =>
  withRepo((root) => {
    const plugin = path.join(root, 'plugin-cache');
    mkdirSync(path.join(plugin, '2.2.3/skills/coding-standards'), { recursive: true });
    writeFileSync(
      path.join(plugin, '2.2.3/skills/coding-standards/SKILL.md'),
      '# Synthetic availability fixture',
    );
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'node --test' } }),
    );
    writeFileSync(
      path.join(root, 'config/project.json'),
      JSON.stringify({
        agents: { enabledRoles: ['developer'] },
        skills: { roots: [], pluginRoots: [plugin], required: ['fixture-definitely-missing'] },
      }),
    );
    const r = run(root);
    assert.ok(r.skills.find((s) => s.name === 'coding-standards').location);
    assert.ok(r.skillsMissing.includes('fixture-definitely-missing'));
    assert.equal(existsSync(path.join(root, '.claude')), false);
  }));

test('preserves custom DETECTION and custom generated profiles even with force', () =>
  withRepo((root) => {
    mkdirSync(path.join(root, 'agents/generated'), { recursive: true });
    const detection = path.join(root, 'agents/generated/DETECTION.json'),
      profile = path.join(root, 'agents/generated/developer.md');
    writeFileSync(detection, '{"custom":true}\n');
    writeFileSync(profile, 'Custom profile');
    run(root, '--write', '--force');
    assert.equal(readFileSync(detection, 'utf8'), '{"custom":true}\n');
    assert.equal(readFileSync(profile, 'utf8'), 'Custom profile');
  }));

test('malformed configuration and escaping role identifiers fail before writes', () =>
  withRepo((root) => {
    for (const content of [
      '{broken',
      JSON.stringify({ agents: { enabledRoles: ['../../outside'] } }),
    ]) {
      writeFileSync(path.join(root, 'config/project.json'), content);
      const result = spawnSync(process.execPath, [script, '--root', root, '--write'], {
        encoding: 'utf8',
      });
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(path.join(root, 'agents')), false);
    }
  }));
