import { z } from 'zod';
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = z
  .string()
  .transform((v) => v.normalize('NFC').trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(1).max(4000));
const date = z.iso.date();
const fields = { name: text.pipe(z.string().max(300)), goal: text, startsOn: date, endsOn: date };
export const iterationStatusSchema = z.enum([
  'PLANNED',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
]);
export const createIterationSchema = z
  .strictObject(fields)
  .refine((v) => v.startsOn <= v.endsOn, { path: ['endsOn'], message: 'End before start' });
export const updateIterationSchema = z
  .strictObject({ ...fields, expectedVersion: version, reason: text })
  .refine((v) => v.startsOn <= v.endsOn, { path: ['endsOn'], message: 'End before start' });
export const transitionIterationSchema = z.strictObject({
  expectedVersion: version,
  to: iterationStatusSchema,
  reason: text,
});
export const assignRequirementSprintSchema = z.strictObject({
  expectedVersion: version,
  sprintId: z.uuid().nullable(),
  reason: text,
});
export const assignPrimaryRequirementSchema = z.strictObject({
  expectedVersion: version,
  requirementId: z.uuid(),
  reason: text,
});
export const prepareSprintExecutionSchema = z.strictObject({ reason: text });
export const participantQuerySchema = z.strictObject({
  entityType: z.enum(['TASK', 'REQUIREMENT']),
  entityId: z.uuid(),
  timeZone: z
    .string()
    .max(100)
    .default('America/Caracas')
    .refine((v) => {
      try {
        new Intl.DateTimeFormat('es', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
});
