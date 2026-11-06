import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Check the actual entry-point tree used by Docker, rather than a successful
// compiler exit that may have emitted files into an unintended nested tree.
const { buildOpenApi } = await import('../apps/api/dist/openapi/document.js');
const expected = JSON.parse(
  await readFile(new URL('../docs/openapi.json', import.meta.url), 'utf8'),
);
const actual = buildOpenApi();
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
assert.equal(
  digest(actual),
  digest(expected),
  'Compiled API contract must match the published artifact',
);
console.log(JSON.stringify({ compiledApiContractMatches: true }));
