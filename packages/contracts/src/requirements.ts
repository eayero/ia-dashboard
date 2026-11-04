import { z } from 'zod';

const version = z.number().int().positive().max(2147483647);
const text = (max: number) =>
  z
    .string()
    .transform((v) => v.normalize('NFC').trim().replace(/\s+/gu, ' '))
    .pipe(z.string().min(1).max(max));
export const createRequirementSchema = z.strictObject({
  title: text(300),
  description: text(4000),
  type: z.enum(['FUNCTIONAL', 'NON_FUNCTIONAL']),
  externalRef: z.string().trim().min(1).max(300).optional(),
});
export const reviseRequirementSchema = createRequirementSchema
  .omit({ externalRef: true })
  .extend({ expectedVersion: version, reason: text(4000) });
export const approveRequirementSchema = z.strictObject({
  expectedVersion: version,
  revision: version,
});
export const linkRequirementSchema = z.strictObject({
  expectedVersion: version,
  taskId: z.uuid(),
  taskVersion: version,
  operation: z.enum(['ADD', 'REMOVE']),
  reason: text(4000),
});
export const evaluateRequirementImpactSchema = linkRequirementSchema
  .omit({ operation: true })
  .extend({ revision: version });
export const requirementQuerySchema = z.strictObject({
  limit: z
    .union([z.number(), z.string().regex(/^\d+$/u).transform(Number)])
    .pipe(z.number().int().min(1).max(100))
    .default(20),
  cursor: z.string().min(1).max(1024).optional(),
});
