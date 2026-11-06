import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTaskSchema,
  claimTaskSchema,
  transitionTaskSchema,
  taskQuerySchema,
  evidenceSchema,
} from './index.ts';

const id = '7f5481cc-9ab3-4e07-a481-cfb8a38f429d';
const task = {
  requirementIds: [id],
  primaryRequirementId: id,
  title: '  Cafe\u0301  central ',
  criteria: [{ id: 'AC-1', description: ' Funciona ', required: true }],
};
test('crear normaliza título y criterios sin permitir gates declarados', () => {
  assert.equal(createTaskSchema.parse(task).title, 'Café central');
  assert.equal(createTaskSchema.parse(task).criteria[0]?.description, 'Funciona');
  for (const extra of [{ status: 'DONE' }, { closureApproved: true }, { projectId: id }]) {
    assert.equal(createTaskSchema.safeParse({ ...task, ...extra }).success, false);
  }
});
test('criterios no pueden estar vacíos ni repetir identificadores', () => {
  for (const criteria of [
    [],
    [{ id: 'a', description: ' ', required: true }],
    [task.criteria[0], task.criteria[0]],
  ]) {
    assert.equal(createTaskSchema.safeParse({ ...task, criteria }).success, false);
  }
});
test('crear exige uno o más requisitos UUID únicos', () => {
  const { requirementIds, ...missing } = task;
  assert.equal(createTaskSchema.safeParse(missing).success, false);
  for (const ids of [[], ['invalid'], [id, id]])
    assert.equal(createTaskSchema.safeParse({ ...task, requirementIds: ids }).success, false);
  assert.equal(requirementIds.length, 1);
});
test('claim requiere sesión y versión entera positiva, sin suplantar principal', () => {
  assert.equal(claimTaskSchema.safeParse({ sessionId: id, expectedVersion: 1 }).success, true);
  for (const payload of [
    { sessionId: 'bad', expectedVersion: 1 },
    { sessionId: id, expectedVersion: 0 },
    { sessionId: id, expectedVersion: 1.1 },
    { sessionId: id, expectedVersion: 1, principalId: id },
  ]) {
    assert.equal(claimTaskSchema.safeParse(payload).success, false);
  }
});
test('transición preserva tokens bigint como decimal y excluye gates del cliente', () => {
  const payload = {
    to: 'IN_REVIEW',
    expectedVersion: 3,
    sessionId: id,
    fencingToken: '9007199254740993',
  };
  assert.equal(transitionTaskSchema.parse(payload).fencingToken, '9007199254740993');
  for (const extra of [
    { fencingToken: 1 },
    { fencingToken: 'abc' },
    { fencingToken: '0' },
    { fencingToken: '-1' },
    { fencingToken: '01' },
    { fencingToken: '9223372036854775808' },
    { evidenceAccepted: true },
  ]) {
    assert.equal(transitionTaskSchema.safeParse({ ...payload, ...extra }).success, false);
  }
});
test('consulta limita paginación y rechaza filtros desconocidos', () => {
  assert.deepEqual(taskQuerySchema.parse({}), { limit: 20 });
  assert.equal(taskQuerySchema.parse({ limit: '100', status: 'READY' }).limit, 100);
  for (const query of [
    { limit: '101' },
    { limit: '-1' },
    { limit: '' },
    { limit: ['20'] },
    { status: 'INVALID' },
    { admin: 'true' },
  ]) {
    assert.equal(taskQuerySchema.safeParse(query).success, false);
  }
});
test('evidencia permite solo HTTPS y no acepta procedencia ni aprobación del cliente', () => {
  const evidence = {
    kind: 'TEST',
    result: { outcome: 'PASS', total: 1, passed: 1 },
    url: 'https://ci.example.test/runs/1',
    commit: 'a'.repeat(40),
    repositoryId: id,
  };
  assert.equal(evidenceSchema.safeParse(evidence).success, true);
  for (const extra of [
    { url: 'invalid url' },
    { url: 'http://ci.example.test/1' },
    { url: 'file:///secret' },
    { url: 'https://user:pass@ci.example.test/1' },
    { provenance: 'HUMAN_ACCEPTED' },
    { accepted: true },
  ]) {
    assert.equal(evidenceSchema.safeParse({ ...evidence, ...extra }).success, false);
  }
});
