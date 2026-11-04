import { z } from 'zod';
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const fencing = z
  .string()
  .regex(/^[1-9]\d{0,18}$/u)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const startWorkSchema = z.strictObject({
  expectedVersion: version,
  sessionId: z.uuid(),
  fencingToken: fencing,
});
export const pauseWorkSchema = startWorkSchema;
export const taskTimeQuerySchema = z.strictObject({
  timeZone: z
    .string()
    .min(1)
    .max(100)
    .regex(/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/u)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('es', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid time zone')
    .default('America/Caracas'),
});
