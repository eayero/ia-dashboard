import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildOpenApi } from './openapi/document.ts';

const document = buildOpenApi();
test('OpenAPI tiene IDs únicos, parámetros completos y referencias locales resolubles', () => {
  const ids = new Set<string>();
  for (const [path, methods] of Object.entries(document.paths))
    for (const operation of Object.values(methods)) {
      assert.ok(!ids.has(operation.operationId));
      ids.add(operation.operationId);
      const parameters = operation.parameters
        .filter((p) => p.in === 'path')
        .map((p) => p.name)
        .sort();
      assert.deepEqual(parameters, [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort());
      assert.ok(operation.responses.default);
    }
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if ('$ref' in value) {
      assert.equal(typeof value.$ref, 'string');
      let target: unknown = document;
      for (const part of String(value.$ref).slice(2).split('/')) {
        assert.ok(
          target && typeof target === 'object' && part in target,
          `Unresolved ${value.$ref}`,
        );
        target = (target as Record<string, unknown>)[part];
      }
    }
    for (const child of Object.values(value)) walk(child);
  };
  walk(document);
});
test('OpenAPI distingue POST humano, bearer, CSRF e idempotencia real', () => {
  const paths = document.paths;
  assert.deepEqual(paths['/api/v1/projects/{projectId}/tasks/{taskId}/validate']!.post!.security, [
    { cookieAuth: [], csrfToken: [] },
  ]);
  assert.deepEqual(paths['/api/v1/projects/{projectId}/tasks']!.post!.security, [
    { cookieAuth: [], csrfToken: [] },
    { agentBearer: [] },
  ]);
  assert.ok(
    paths['/api/v1/projects/{projectId}/tasks']!.post!.parameters.some(
      (p) => p.name === 'Idempotency-Key' && p.required,
    ),
  );
  assert.ok(!paths['/api/v1/agents']!.post!.parameters.some((p) => p.name === 'Idempotency-Key'));
  assert.deepEqual(paths['/api/v1/auth/session']!.get!.security, []);
  assert.deepEqual(
    paths['/api/v1/projects/{projectId}/tasks/{taskId}/start-work']!.post!.security,
    [{ agentBearer: [] }],
  );
  assert.deepEqual(document.components.schemas.createOwnAgentInput!.oneOf, [
    { required: ['projectId'], not: { required: ['projectIds'] } },
    { required: ['projectIds'], not: { required: ['projectId'] } },
  ]);
  assert.equal(document.components.schemas.transitionTaskInput!.additionalProperties, false);
});
test('artefacto OpenAPI versionable coincide con el generador y no refleja hosts privados', async () => {
  assert.deepEqual(
    JSON.parse(await readFile(new URL('../../../docs/openapi.json', import.meta.url), 'utf8')),
    document,
  );
  assert.deepEqual(document.servers, [{ url: '/' }]);
  assert.equal(JSON.stringify(document).includes('token_hash'), false);
});
