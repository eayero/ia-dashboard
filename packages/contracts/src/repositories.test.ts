import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as contracts from './index.ts';

test('repository registration normalizes metadata and rejects credential-bearing URLs', () => {
  assert.equal(typeof contracts.registerRepositorySchema, 'object');
  const schema = contracts.registerRepositorySchema;
  assert.deepEqual(
    schema.parse({
      name: '  Cafe\u0301   dashboard  ',
      url: 'https://GITHUB.COM:443/eayero/ia-dashboard',
    }),
    { name: 'Café dashboard', url: 'https://github.com/eayero/ia-dashboard' },
  );
  for (const url of [
    'http://github.com/repo',
    'https://user:password@github.com/repo',
    'https://user@github.com/repo',
    'https://github.com/repo?token=secret',
    'https://github.com/repo?',
    'https://github.com/repo#fragment',
    'https://github.com/repo#',
    'not a URL',
    'https://github.com/\nrepo',
  ])
    assert.equal(schema.safeParse({ name: 'repo', url }).success, false, url);
  for (const input of [
    { name: ' ', url: 'https://github.com/repo' },
    { name: 'repo', url: 'https://github.com/repo', projectId: 'injected' },
    { name: 'repo', url: 'https://github.com/' + 'a'.repeat(2048) },
  ])
    assert.equal(schema.safeParse(input).success, false);
  assert.notEqual(
    schema.parse({ name: 'repo', url: 'https://github.com/Owner/Repo.git' }).url,
    schema.parse({ name: 'repo', url: 'https://github.com/owner/repo' }).url,
  );
});

test('repository pagination enforces default and maximum page sizes', () => {
  assert.equal(typeof contracts.repositoryQuerySchema, 'object');
  const schema = contracts.repositoryQuerySchema;
  assert.deepEqual(schema.parse({}), { limit: 20 });
  assert.deepEqual(schema.parse({ limit: '100' }), { limit: 100 });
  for (const query of [{ limit: 0 }, { limit: 101 }, { cursor: '' }, { status: 'DONE' }])
    assert.equal(schema.safeParse(query).success, false);
});
