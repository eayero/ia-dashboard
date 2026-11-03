import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfiguration } from './config.ts';
import { loadOutboxConfiguration } from './outbox/config.ts';

const env = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://localhost:55432/acc',
  SESSION_SECRET: 'x'.repeat(64),
  OIDC_ISSUER: 'http://localhost:58080/realms/acc',
  OIDC_CLIENT_ID: 'acc-web',
  OIDC_CLIENT_SECRET: 'synthetic-configuration-only',
  PUBLIC_ORIGIN: 'http://localhost:55173',
  API_PORT: '53000',
};
test('configuración local valida origen y deriva callback sin confiar en Host', () => {
  const config = loadConfiguration(env);
  assert.equal(config.callbackUrl, 'http://localhost:55173/api/v1/auth/callback');
  assert.equal(config.secureCookie, false);
});
test('producción exige HTTPS y secretos de sesión suficientes', () => {
  for (const extra of [
    { NODE_ENV: 'production' },
    { SESSION_SECRET: 'short' },
    { PUBLIC_ORIGIN: 'http://external.test' },
    { OIDC_ISSUER: 'http://external.test/realm' },
    { PUBLIC_ORIGIN: 'http://localhost:55173/path' },
    { PUBLIC_ORIGIN: 'https://user:pass@example.test' },
  ]) {
    assert.throws(() => loadConfiguration({ ...env, ...extra }), {
      message: 'Invalid API configuration',
    });
  }
  const config = loadConfiguration({
    ...env,
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: 'https://acc.example.test',
    OIDC_ISSUER: 'https://identity.example.test/realm',
  });
  assert.equal(config.secureCookie, true);
});
test('worker valida Redis y sus tiempos sin requerir credenciales OIDC', () => {
  const env = {
    DATABASE_URL: 'postgresql://localhost:55432/acc',
    REDIS_URL: 'redis://localhost:56379',
  };
  assert.equal(loadOutboxConfiguration(env).pollMs, 250);
  for (const extra of [
    { REDIS_URL: 'https://example.test' },
    { REDIS_URL: '' },
    { OUTBOX_POLL_MS: '0' },
    { OUTBOX_POLL_MS: '60000' },
  ])
    assert.throws(() => loadOutboxConfiguration({ ...env, ...extra }), {
      message: 'Invalid outbox configuration',
    });
});
