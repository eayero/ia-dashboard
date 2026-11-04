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
    password = secret();
  const env = {
    POSTGRES_USER: 'acc',
    POSTGRES_DB: 'acc',
    POSTGRES_PASSWORD: db,
    DATABASE_URL: `postgresql://acc:${db}@localhost:55432/acc`,
    REDIS_PASSWORD: redis,
    REDIS_URL: `redis://:${redis}@localhost:56379`,
    SESSION_SECRET: secret(),
    PUBLIC_ORIGIN: 'http://localhost:55173',
    API_PORT: '53000',
    NODE_ENV: 'development',
  };
  await mkdir('.cache', { recursive: true });
  await writeFile(
    '.env',
    Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  await writeFile(
    '.cache/local-login.txt',
    `Solo desarrollo local. Usuario: owner\nContraseña: ${password}\n`,
    { mode: 0o600 },
  );
  console.log(
    'Configuración local ACC creada. Credenciales iniciales en .cache/local-login.txt; no se imprimen secretos.',
  );
}
