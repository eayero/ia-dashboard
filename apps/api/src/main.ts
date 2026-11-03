import { Pool } from '@acc/db';
import { loadConfiguration } from './config.ts';
import { createApplication } from './app.ts';

let pool: InstanceType<typeof Pool> | undefined;
try {
  const config = loadConfiguration(process.env);
  pool = new Pool({ connectionString: config.databaseUrl });
  const app = await createApplication(config, pool);
  await app.listen(config.port, '127.0.0.1');
  console.log(`ACC API listening on loopback port ${config.port}`);
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      await app.close();
      await pool!.end();
    })());
  process.once('SIGINT', () => {
    void stop();
  });
  process.once('SIGTERM', () => {
    void stop();
  });
} catch {
  console.error(
    'API startup failed. Check configuration, database migrations and OIDC availability.',
  );
  await pool?.end();
  process.exitCode = 1;
}
