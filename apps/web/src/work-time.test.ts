import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWorkDuration } from './work-time.ts';
test('tiempo acumulado conserva horas superiores a un día sin redondear pausas', () => {
  assert.equal(formatWorkDuration('90061000'), '25 h 1 min 1 s');
  assert.equal(formatWorkDuration('0'), '0 s');
  assert.equal(formatWorkDuration('999'), '0 s');
});
