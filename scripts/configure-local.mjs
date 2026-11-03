import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';

try {
  await access('.env');
  console.error('.env ya existe. No se sobrescriben secretos ni credenciales.');
  process.exitCode = 1;
} catch {
  const secret = () => randomBytes(32).toString('hex');
  const db = secret(),
    redis = secret(),
    admin = secret(),
    oidc = secret();
  const humanPassword = secret();
  const env = {
    POSTGRES_USER: 'acc',
    POSTGRES_DB: 'acc',
    POSTGRES_PASSWORD: db,
    DATABASE_URL: `postgresql://acc:${db}@localhost:55432/acc`,
    REDIS_PASSWORD: redis,
    REDIS_URL: `redis://:${redis}@localhost:56379`,
    KEYCLOAK_ADMIN: 'acc-admin',
    KEYCLOAK_ADMIN_PASSWORD: admin,
    OIDC_CLIENT_SECRET: oidc,
    SESSION_SECRET: secret(),
    PUBLIC_ORIGIN: 'http://localhost:55173',
    OIDC_ISSUER: 'http://localhost:58080/realms/acc',
    OIDC_CLIENT_ID: 'acc-web',
    API_PORT: '53000',
    NODE_ENV: 'development',
  };
  await mkdir('.cache/keycloak', { recursive: true });
  const realm = {
    realm: 'acc',
    enabled: true,
    registrationAllowed: false,
    sslRequired: 'none',
    clients: [
      {
        clientId: 'acc-web',
        enabled: true,
        publicClient: false,
        secret: oidc,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        redirectUris: ['http://localhost:55173/api/v1/auth/callback'],
        webOrigins: ['http://localhost:55173'],
        attributes: { 'pkce.code.challenge.method': 'S256' },
      },
    ],
    users: [
      {
        username: 'owner',
        enabled: true,
        email: 'owner@example.invalid',
        emailVerified: true,
        firstName: 'Propietario',
        lastName: 'Demo',
        credentials: [{ type: 'password', value: humanPassword, temporary: false }],
      },
    ],
  };
  await writeFile(
    '.env',
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  await writeFile('.cache/keycloak/realm.json', JSON.stringify(realm, null, 2), { mode: 0o600 });
  await writeFile(
    '.cache/local-login.txt',
    `Solo desarrollo local. Usuario: owner\nContraseña: ${humanPassword}\n`,
    { mode: 0o600 },
  );
  console.log(
    'Configuración local creada. Credenciales en .cache/local-login.txt; no se imprimen secretos.',
  );
}
