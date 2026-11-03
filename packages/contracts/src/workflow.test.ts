import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as contracts from './index.ts';

const id = '7f5481cc-9ab3-4e07-a481-cfb8a38f429d';
test('actualización del trabajo exige claim completo y no admite gates declarados', () => {
  const input = { expectedVersion: 2, sessionId: id, fencingToken: '2', summary: ' Resultado ' };
  assert.equal(contracts.updateWorkSchema.parse(input).summary, 'Resultado');
  for (const extra of [
    { summary: ' ' },
    { sessionId: undefined },
    { verified: true },
    { closureApproved: true },
  ]) {
    assert.equal(contracts.updateWorkSchema.safeParse({ ...input, ...extra }).success, false);
  }
});
test('adjuntar evidencia requiere criterios identificados y no permite aceptar su procedencia', () => {
  const input = {
    expectedVersion: 1,
    sessionId: id,
    fencingToken: '1',
    kind: 'OTHER',
    url: 'https://example.test/report',
    criterionIds: ['AC-1'],
  };
  assert.equal(contracts.addEvidenceSchema.safeParse(input).success, true);
  for (const extra of [
    { criterionIds: [] },
    { criterionIds: ['a', 'a'] },
    { acceptedBy: id },
    { provenance: 'VERIFIED' },
    { fencingToken: undefined },
  ]) {
    assert.equal(contracts.addEvidenceSchema.safeParse({ ...input, ...extra }).success, false);
  }
});
test('aprobación identifica revisión y etapa, sin permitir elegir aprobador', () => {
  const input = { expectedVersion: 4, workRevision: 2, kind: 'CLOSURE' };
  assert.equal(contracts.approveTaskSchema.safeParse(input).success, true);
  for (const extra of [{ workRevision: 0 }, { kind: 'ALL' }, { actorId: id }, { approved: true }]) {
    assert.equal(contracts.approveTaskSchema.safeParse({ ...input, ...extra }).success, false);
  }
});
test('dependencia y revisión humana exigen motivo y contenido estructurado', () => {
  assert.equal(
    contracts.dependencySchema.safeParse({
      expectedVersion: 1,
      dependsOn: id,
      operation: 'ADD',
      reason: 'Orden de ejecución',
    }).success,
    true,
  );
  assert.equal(
    contracts.dependencySchema.safeParse({ expectedVersion: 1, dependsOn: id, operation: 'ADD' })
      .success,
    false,
  );
  assert.equal(
    contracts.reviseTaskSchema.safeParse({
      expectedVersion: 1,
      reason: 'Nuevo alcance',
      title: 'Otro',
      criteria: [{ id: 'a', description: 'Valida', required: true }],
    }).success,
    true,
  );
});
test('evidencia de código exige hash completo SHA-1 o SHA-256', () => {
  const input = { kind: 'CODE', url: 'https://example.test/commit', repositoryId: id };
  for (const length of [39, 41, 63, 65])
    assert.equal(
      contracts.evidenceSchema.safeParse({ ...input, commit: 'a'.repeat(length) }).success,
      false,
    );
  for (const length of [40, 64])
    assert.equal(
      contracts.evidenceSchema.safeParse({ ...input, commit: 'a'.repeat(length) }).success,
      true,
    );
});
test('evidencia de pruebas exige resultado consistente y estructurado', () => {
  const input = {
    kind: 'TEST',
    url: 'https://example.test/run',
    repositoryId: id,
    commit: 'a'.repeat(40),
  };
  assert.equal(contracts.evidenceSchema.safeParse(input).success, false);
  assert.equal(
    contracts.evidenceSchema.safeParse({
      ...input,
      result: { outcome: 'PASS', total: 3, passed: 2 },
    }).success,
    false,
  );
  assert.equal(
    contracts.evidenceSchema.safeParse({
      ...input,
      result: { outcome: 'PASS', total: 3, passed: 3 },
    }).success,
    true,
  );
  assert.equal(
    contracts.evidenceSchema.safeParse({
      ...input,
      result: { outcome: 'FAIL', total: 3, passed: 2 },
    }).success,
    true,
  );
});
