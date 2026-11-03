import { z } from 'zod';

export function loadConfiguration(env: Record<string, string | undefined>) {
  try {
    const values = z
      .object({
        NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
        DATABASE_URL: z.string().min(1),
        SESSION_SECRET: z.string().min(32),
        PUBLIC_ORIGIN: z.url(),
        OIDC_ISSUER: z.url(),
        OIDC_CLIENT_ID: z.string().min(1),
        OIDC_CLIENT_SECRET: z.string().min(1),
        API_PORT: z.coerce.number().int().min(1).max(65535).default(53000),
      })
      .parse(env);
    const origin = new URL(values.PUBLIC_ORIGIN);
    const issuer = new URL(values.OIDC_ISSUER);
    for (const url of [origin, issuer]) {
      if (url.username || url.password || url.search || url.hash) throw new Error();
      if (
        url.protocol !== 'https:' &&
        !(
          values.NODE_ENV !== 'production' &&
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        )
      )
        throw new Error();
    }
    if (origin.pathname !== '/') throw new Error();
    const database = new URL(values.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error();
    return {
      nodeEnv: values.NODE_ENV,
      databaseUrl: values.DATABASE_URL,
      sessionSecret: values.SESSION_SECRET,
      publicOrigin: origin.origin,
      issuer: issuer.href,
      clientId: values.OIDC_CLIENT_ID,
      clientSecret: values.OIDC_CLIENT_SECRET,
      port: values.API_PORT,
      secureCookie: values.NODE_ENV === 'production' || origin.protocol === 'https:',
      callbackUrl: `${origin.origin}/api/v1/auth/callback`,
    };
  } catch {
    throw new Error('Invalid API configuration');
  }
}
export type ApiConfiguration = ReturnType<typeof loadConfiguration>;
