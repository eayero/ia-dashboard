import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as selection from './requirements-data.ts';
import type { DashboardState } from './data.ts';

const state = (records: DashboardState['records']) => ({ records }) as DashboardState;
const records: DashboardState['records'] = [
  {
    entityType: 'REQUIREMENT',
    data: { id: 'req', publicId: 'REQ-1', version: 3, revision: 2, approvedRevision: 1 },
  },
  {
    entityType: 'REQUIREMENT_REVISION',
    data: {
      requirementId: 'req',
      revision: 1,
      title: 'Alcance vigente',
      description: 'Original',
      type: 'FUNCTIONAL',
      status: 'APPROVED',
    },
  },
  {
    entityType: 'REQUIREMENT_REVISION',
    data: {
      requirementId: 'req',
      revision: 2,
      title: 'Propuesta nueva',
      description: 'Cambio',
      type: 'FUNCTIONAL',
      status: 'DRAFT',
    },
  },
  {
    entityType: 'TASK',
    data: { id: 'task', publicId: 'TASK-1', title: 'Entrega', status: 'DONE', version: 4 },
  },
  {
    entityType: 'REQUIREMENT_LINK',
    data: {
      requirementId: 'req',
      taskId: 'task',
      approvedRevision: 1,
      evaluatedRevision: null,
      impactPending: true,
    },
  },
  {
    entityType: 'REQUIREMENT_IMPACT_ALERT',
    data: { id: 'alert', requirementId: 'req', taskId: 'task', revision: 1 },
  },
];
test('catálogo distingue propuesta pendiente y alcance aprobado sin mezclar revisiones', () => {
  assert.equal(typeof selection.requirementCatalog, 'function');
  const [item] = selection.requirementCatalog(state(records));
  assert.equal(item!.current.title, 'Propuesta nueva');
  assert.equal(item!.approved!.title, 'Alcance vigente');
  assert.equal(item!.pendingProposal, true);
  assert.equal(item!.pendingImpacts, 1);
});
test('atención deduplica alerta DONE y no mantiene alertas históricas ya evaluadas', () => {
  const attention = selection.requirementAttention(state(records));
  assert.equal(attention.length, 1);
  assert.equal(attention[0]!.completed, true);
  const evaluated = records.map((r) =>
    r.entityType === 'REQUIREMENT_LINK'
      ? { ...r, data: { ...r.data, evaluatedRevision: 1, impactPending: false } }
      : r,
  );
  assert.equal(selection.requirementAttention(state(evaluated)).length, 0);
});
test('filtros distinguen tipo, propuesta e impacto y búsqueda por ID', () => {
  const list = selection.requirementCatalog(state(records));
  assert.equal(selection.filterRequirements(list, 'REQ-1', 'ALL', 'PROPOSAL').length, 1);
  assert.equal(selection.filterRequirements(list, '', 'NON_FUNCTIONAL', 'ALL').length, 0);
  assert.equal(selection.filterRequirements(list, '', 'ALL', 'IMPACT').length, 1);
});
test('snapshot sin la revisión aprobada rechaza catálogo parcial', () => {
  assert.throws(
    () =>
      selection.requirementCatalog(
        state(
          records.filter(
            (r) => !(r.entityType === 'REQUIREMENT_REVISION' && r.data.revision === 1),
          ),
        ),
      ),
    /CONTEXT_INCONSISTENT/u,
  );
});
