import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './auth/password.ts';

test('scrypt usa sal aleatoria y comprueba contraseñas completas sin guardar texto claro', async () => {
  const password = 'synthetic password with spaces 123';
  const a = await hashPassword(password);
  const b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.equal(a.includes(password), false);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword(`${password} `, a), false);
  assert.equal(await verifyPassword('wrong', a), false);
});
test('hash malformado o parámetros no admitidos se rechazan sin ejecutar costes arbitrarios', async () => {
  for (const encoded of ['', 'plain text', 'scrypt$999999999$8$1$abc$def'])
    assert.equal(await verifyPassword('synthetic', encoded), false);
});
