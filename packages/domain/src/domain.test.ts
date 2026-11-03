import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson,
  normalizeTitle,
  transition,
  assertClaim,
  approvalGates,
  type TransitionInput,
} from './index.ts';

const human = { kind: 'HUMAN' as const, roles: ['OWNER' as const], scopes: [] };
const agent = { kind: 'AGENT' as const, roles: [], scopes: ['task:write'] };
const valid: TransitionInput = {
  from: 'IN_QA',
  to: 'DONE',
  actor: human,
  hasClaim: false,
  criteria: [
    {
      id: 'AC-1',
      description: 'Verifica exclusividad',
      required: true,
      verified: true,
      evidenceIds: ['e-1'],
    },
  ],
  evidenceAccepted: true,
  dependenciesMet: true,
  impactPending: false,
  reviewApproved: true,
  qaApproved: true,
  closureApproved: true,
};
test('un humano cierra solo con todos los gates satisfechos', () => {
  assert.deepEqual(transition(valid), { status: 'DONE', releaseClaim: true });
});
for (const [field, value, gate] of [
  ['evidenceAccepted', false, 'EVIDENCE_REQUIRED'],
  ['dependenciesMet', false, 'DEPENDENCIES_UNMET'],
  ['impactPending', true, 'IMPACT_REVIEW_REQUIRED'],
  ['reviewApproved', false, 'REVIEW_REQUIRED'],
  ['qaApproved', false, 'QA_REQUIRED'],
  ['closureApproved', false, 'HUMAN_APPROVAL_REQUIRED'],
] as const) {
  test(`DONE rechaza gate incumplido: ${gate}`, () => {
    assert.throws(() => transition({ ...valid, [field]: value }), { code: gate });
  });
}
test('un agente no puede aprobar cierre aunque declare todos los gates', () => {
  assert.throws(() => transition({ ...valid, actor: agent }), { code: 'FORBIDDEN' });
});
test('VIEWER no muta tareas', () => {
  assert.throws(() => transition({ ...valid, actor: { ...human, roles: ['VIEWER'] } }), {
    code: 'FORBIDDEN',
  });
});
test('criterio obligatorio sin evidencia impide DONE', () => {
  assert.throws(
    () => transition({ ...valid, criteria: [{ ...valid.criteria[0]!, evidenceIds: [] }] }),
    { code: 'CRITERIA_UNMET' },
  );
});
test('no se puede saltar de READY a DONE', () => {
  assert.throws(() => transition({ ...valid, from: 'READY' }), { code: 'INVALID_TRANSITION' });
});
test('iniciar implementación requiere claim vigente', () => {
  assert.throws(() => transition({ ...valid, actor: agent, from: 'READY', to: 'IN_PROGRESS' }), {
    code: 'CLAIM_REQUIRED',
  });
});
test('rechazo humano de QA exige motivo y libera propiedad', () => {
  assert.throws(() => transition({ ...valid, to: 'IN_PROGRESS' }), { code: 'REASON_REQUIRED' });
  assert.deepEqual(transition({ ...valid, to: 'IN_PROGRESS', reason: 'Falla aislamiento' }), {
    status: 'IN_PROGRESS',
    releaseClaim: true,
  });
});
test('entregar a revisión exige implementación y libera claim', () => {
  assert.deepEqual(
    transition({ ...valid, actor: agent, from: 'IN_PROGRESS', to: 'IN_REVIEW', hasClaim: true }),
    { status: 'IN_REVIEW', releaseClaim: true },
  );
  assert.throws(
    () =>
      transition({ ...valid, actor: agent, from: 'IN_PROGRESS', to: 'IN_REVIEW', hasClaim: false }),
    { code: 'CLAIM_REQUIRED' },
  );
});
test('normaliza Unicode compuesto y espacios sin convertir similitud en identidad', () => {
  assert.equal(normalizeTitle('  Cafe\u0301\n  central  '), 'Café central');
});
test('payload canónico no depende del orden de las claves y conserva orden de arrays', () => {
  assert.equal(canonicalJson({ z: [2, 1], a: { y: 2, x: 1 } }), '{"a":{"x":1,"y":2},"z":[2,1]}');
});

test('aprobaciones de otra revisión no habilitan el cierre', () => {
  assert.deepEqual(
    approvalGates(3, [
      { kind: 'REVIEW', workRevision: 2, approved: true, actor: human },
      { kind: 'QA', workRevision: 3, approved: true, actor: human },
      { kind: 'CLOSURE', workRevision: 3, approved: true, actor: agent },
    ]),
    { reviewApproved: false, qaApproved: true, closureApproved: false },
  );
});

test('roles humanos acumulados pueden aprobar las tres etapas de la revisión actual', () => {
  assert.deepEqual(
    approvalGates(
      3,
      (['REVIEW', 'QA', 'CLOSURE'] as const).map((kind) => ({
        kind,
        workRevision: 3,
        approved: true,
        actor: { ...human, roles: ['VIEWER', 'REVIEWER'] },
      })),
    ),
    { reviewApproved: true, qaApproved: true, closureApproved: true },
  );
});

const lease = {
  principalId: 'p-1',
  sessionId: 's-1',
  fencingToken: 2n,
  expiresAt: 1000,
  revoked: false,
};
const write = {
  principalId: 'p-1',
  sessionId: 's-1',
  fencingToken: 2n,
  expectedVersion: 4,
  actualVersion: 4,
  now: 999,
  sessionActive: true,
};
test('una escritura con lease vigente conserva propiedad y versión', () => {
  assert.doesNotThrow(() => assertClaim(lease, write));
});
for (const [name, claim, context, code] of [
  ['sin claim', null, write, 'CLAIM_REQUIRED'],
  ['otra sesión', lease, { ...write, sessionId: 's-2' }, 'STALE_CLAIM'],
  ['otro principal', lease, { ...write, principalId: 'p-2' }, 'STALE_CLAIM'],
  ['token anterior', lease, { ...write, fencingToken: 1n }, 'STALE_CLAIM'],
  ['expirado en el límite', lease, { ...write, now: 1000 }, 'STALE_CLAIM'],
  ['revocado', { ...lease, revoked: true }, write, 'STALE_CLAIM'],
  ['sesión finalizada', lease, { ...write, sessionActive: false }, 'STALE_CLAIM'],
  ['versión obsoleta', lease, { ...write, expectedVersion: 3 }, 'VERSION_CONFLICT'],
] as const) {
  test(`escritura rechazada: ${name}`, () =>
    assert.throws(() => assertClaim(claim, context), { code }));
}

test('payload idempotente rechaza valores que JSON perdería o transformaría', () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const value of [
    undefined,
    NaN,
    Infinity,
    1n,
    new Date(),
    new Map(),
    { x: undefined },
    Array(1),
    cycle,
  ]) {
    assert.throws(() => canonicalJson(value), { code: 'INVALID_JSON' });
  }
});
