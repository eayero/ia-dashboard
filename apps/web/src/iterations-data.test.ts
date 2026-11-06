import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inheritedSprint, executionMessage, sprintText } from './iterations-data.ts';
test('only the primary requirement determines the inherited sprint', () => {
  const requirements = [
    { id: 'main', sprintId: 'one' },
    { id: 'secondary', sprintId: 'two' },
  ];
  assert.equal(inheritedSprint('main', requirements), 'one');
  assert.equal(inheritedSprint(null, requirements), null);
  assert.equal(inheritedSprint('missing', requirements), null);
});
test('execution messages distinguish missing planning and inactive sprints', () => {
  assert.match(executionMessage('PRIMARY_REQUIREMENT_REQUIRED'), /principal/);
  assert.match(executionMessage('SPRINT_REQUIRED'), /sprint/);
  assert.match(executionMessage('SPRINT_NOT_ACTIVE'), /ejecución/);
  assert.equal(executionMessage(null), '');
  assert.equal(sprintText.PAUSED, 'Pausado');
});
