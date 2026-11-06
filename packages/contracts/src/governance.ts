import { z } from 'zod';
const id = z.uuid();
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = z
  .string()
  .transform((v) => v.normalize('NFC').trim())
  .pipe(z.string().min(1).max(8000));
const title = text.pipe(z.string().max(300));
const ids = z
  .array(id)
  .max(100)
  .refine((v) => new Set(v).size === v.length, 'Duplicate link');
const refs = {
  taskIds: ids.default([]),
  requirementIds: ids.default([]),
  questionIds: ids.default([]),
};
const questionFields = {
  title,
  description: text,
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
};
export const createQuestionSchema = z.strictObject({
  ...questionFields,
  externalRef: text.optional(),
  taskIds: refs.taskIds,
  requirementIds: refs.requirementIds,
});
export const reviseQuestionSchema = z.strictObject({
  ...questionFields,
  expectedVersion: version,
  reason: text,
});
export const answerQuestionSchema = z.strictObject({ expectedVersion: version, text });
export const resolveQuestionSchema = z.strictObject({
  expectedVersion: version,
  answerId: id,
  reason: text,
});
export const questionStatusSchema = z.strictObject({
  expectedVersion: version,
  to: z.enum(['OPEN', 'CANCELLED']),
  reason: text,
});
export const linkQuestionSchema = z.strictObject({
  expectedVersion: version,
  taskId: id,
  taskVersion: version,
  hard: z.boolean(),
  operation: z.enum(['ADD', 'REMOVE']),
  reason: text,
});
const decisionFields = {
  title,
  context: text,
  alternatives: z.array(title).min(2).max(12),
  choice: title,
  rationale: text,
};
const validDecision = (v: { alternatives: string[]; choice: string }) =>
  new Set(v.alternatives).size === v.alternatives.length && v.alternatives.includes(v.choice);
export const createDecisionSchema = z
  .strictObject({ ...decisionFields, ...refs, externalRef: text.optional() })
  .refine(validDecision, 'Choose a distinct listed alternative');
export const reviseDecisionSchema = z
  .strictObject({ ...decisionFields, expectedVersion: version, reason: text })
  .refine(validDecision, 'Choose a distinct listed alternative');
export const approveDecisionSchema = z.strictObject({
  expectedVersion: version,
  revision: version,
  reason: text,
});
export const linkDecisionSchema = z.strictObject({
  expectedVersion: version,
  taskId: id,
  taskVersion: version,
  operation: z.enum(['ADD', 'REMOVE']),
  reason: text,
});
export const evaluateDecisionImpactSchema = z.strictObject({
  expectedVersion: version,
  taskId: id,
  taskVersion: version,
  revision: version,
  reason: text,
});
export const governanceQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(4000).optional(),
  status: z.enum(['OPEN', 'RESOLVED', 'CANCELLED', 'DRAFT', 'APPROVED', 'SUPERSEDED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).optional(),
});
