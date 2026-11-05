import { z } from 'zod';
export * from './requirements.ts';
export * from './work-time.ts';
export * from './repositories.ts';

export const taskStatusSchema = z.enum([
  'BACKLOG',
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
  'IN_REVIEW',
  'IN_QA',
  'DONE',
  'CANCELLED',
]);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = z.string().transform((value) => value.normalize('NFC').trim().replace(/\s+/gu, ' '));
const title = text.pipe(z.string().min(1).max(300));
const description = text.pipe(z.string().min(1).max(4000));
const token = z
  .string()
  .regex(/^[1-9]\d{0,18}$/u)
  .pipe(z.string().refine((value) => BigInt(value) <= 9223372036854775807n));
const criterion = z.strictObject({
  id: z.string().trim().min(1).max(100),
  description,
  required: z.boolean(),
});
export const createTaskSchema = z.strictObject({
  title,
  requirementIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate requirement ID'),
  workType: z.enum(['CODE', 'OTHER']).default('OTHER'),
  criteria: z
    .array(criterion)
    .min(1)
    .max(100)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      'Duplicate criterion ID',
    ),
  externalRef: z.string().trim().min(1).max(300).optional(),
});
export const claimTaskSchema = z.strictObject({ sessionId: z.uuid(), expectedVersion: version });
export const emptyCommandSchema = z.strictObject({});
export const sessionHeartbeatSchema = z.strictObject({ expectedVersion: version });
export const heartbeatClaimSchema = claimTaskSchema.extend({ fencingToken: token });
export const revokeClaimSchema = z.strictObject({ expectedVersion: version, reason: description });
export const updateWorkSchema = heartbeatClaimSchema.extend({ summary: description });
export const reviseTaskSchema = createTaskSchema
  .omit({ externalRef: true, requirementIds: true })
  .extend({ expectedVersion: version, reason: description });
export const approvalKindSchema = z.enum(['REVIEW', 'QA', 'CLOSURE']);
export const approveTaskSchema = z.strictObject({
  expectedVersion: version,
  workRevision: version,
  kind: approvalKindSchema,
});
export const acceptEvidenceSchema = z.strictObject({
  expectedVersion: version,
  evidenceId: z.uuid(),
});
export const dependencySchema = z.strictObject({
  expectedVersion: version,
  dependsOn: z.uuid(),
  operation: z.enum(['ADD', 'REMOVE']),
  reason: description,
});
export const transitionTaskSchema = z
  .strictObject({
    to: taskStatusSchema,
    expectedVersion: version,
    reason: description.optional(),
    sessionId: z.uuid().optional(),
    fencingToken: token.optional(),
  })
  .refine(
    (value) => Boolean(value.sessionId) === Boolean(value.fencingToken),
    'Session and fencing token must be supplied together',
  );
export const taskQuerySchema = z.strictObject({
  limit: z
    .union([z.number(), z.string().regex(/^\d+$/u).transform(Number)])
    .pipe(z.number().int().min(1).max(100))
    .default(20),
  cursor: z.string().min(1).max(512).optional(),
  status: taskStatusSchema.optional(),
});
const testResultSchema = z
  .strictObject({
    outcome: z.enum(['PASS', 'FAIL']),
    total: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    passed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .refine(
    (value) =>
      value.passed <= value.total &&
      (value.outcome === 'PASS' ? value.passed === value.total : value.passed < value.total),
    'Inconsistent test result',
  );
export const evidenceSchema = z
  .strictObject({
    kind: z.enum(['CODE', 'TEST', 'REVIEW', 'OTHER']),
    url: z.url({ protocol: /^https$/u }).pipe(
      z.string().refine((value) => {
        const url = new URL(value);
        return !url.username && !url.password;
      }),
    ),
    repositoryId: z.uuid().optional(),
    result: testResultSchema.optional(),
    commit: z
      .string()
      .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
      .optional(),
  })
  .refine(
    (value) =>
      !['CODE', 'TEST'].includes(value.kind) || Boolean(value.repositoryId && value.commit),
    'Code and test evidence requires repository and commit',
  )
  .refine(
    (value) => (value.kind === 'TEST' ? Boolean(value.result) : !value.result),
    'Only test evidence requires a structured result',
  );

export const addEvidenceSchema = evidenceSchema
  .safeExtend({
    expectedVersion: version,
    sessionId: z.uuid().optional(),
    fencingToken: token.optional(),
    criterionIds: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .refine(
    (value) => Boolean(value.sessionId) === Boolean(value.fencingToken),
    'Session and fencing token must be supplied together',
  );

export type CreateTask = z.infer<typeof createTaskSchema>;
export type ClaimTask = z.infer<typeof claimTaskSchema>;
export type TransitionTask = z.infer<typeof transitionTaskSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type SuccessEnvelope<T> = {
  data: T;
  meta: { requestId: string; version?: number; projectSeq?: string };
};
export type ErrorEnvelope = {
  error: { code: string; message: string; details?: unknown; requestId: string };
};

export const sequenceSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,18})$/u)
  .pipe(z.string().refine((value) => BigInt(value) <= 9223372036854775807n));
const pageLimitSchema = z
  .union([z.number(), z.string().regex(/^\d+$/u).transform(Number)])
  .pipe(z.number().int().min(1).max(100));
export const contextQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(1024).optional(),
  limit: pageLimitSchema.optional(),
});
export const eventsQuerySchema = z
  .strictObject({
    cursor: z.string().min(1).max(1024).optional(),
    afterSeq: sequenceSchema.optional(),
    limit: pageLimitSchema.default(20),
  })
  .refine((value) => !(value.cursor && value.afterSeq !== undefined), 'Use cursor or afterSeq');
export const eventEnvelopeSchema = z.strictObject({
  eventId: z.uuid(),
  projectId: z.uuid(),
  seq: sequenceSchema.pipe(z.string().refine((value) => BigInt(value) > 0n)),
  schemaVersion: z.literal(1),
  type: z.string().min(1).max(100),
  occurredAt: z.iso.datetime({ offset: true }),
  entity: z.strictObject({
    id: z.uuid(),
    type: z.enum(['TASK', 'SESSION', 'PRINCIPAL', 'REQUIREMENT', 'REPOSITORY']),
  }),
  actorId: z.uuid(),
  actorUserId: z.uuid().nullable().optional(),
  sessionId: z.uuid().nullable(),
  traceId: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type ContextRecord = { entityType: string; data: Record<string, unknown> };

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_.-]{2,63}$/u);
export const passwordSchema = z.string().min(15).max(128);
export const loginSchema = z.strictObject({
  username: usernameSchema,
  password: z.string().min(1).max(128),
});
export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export const validateTaskSchema = z.strictObject({
  expectedVersion: version,
  workRevision: version,
  note: description.optional(),
});
export const createUserSchema = z.strictObject({
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(120),
  password: passwordSchema,
  systemRole: z.enum(['ADMIN', 'USER']).default('USER'),
});
export const resetPasswordSchema = z.strictObject({ password: passwordSchema });
export const userStatusSchema = z.strictObject({ disabled: z.boolean() });
export const membershipSchema = z.strictObject({
  active: z.boolean(),
  expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  roles: z
    .array(z.enum(['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'VIEWER']))
    .min(1)
    .max(5)
    .refine((roles) => new Set(roles).size === roles.length),
});
const agentScopesSchema = z
  .array(z.enum(['task:read', 'task:write']))
  .min(1)
  .max(2)
  .refine((scopes) => scopes.includes('task:read') && new Set(scopes).size === scopes.length);
export const agentCredentialSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(120),
    ownerUserId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    projectIds: z
      .array(z.uuid())
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    scopes: z
      .array(z.enum(['task:read', 'task:write']))
      .min(1)
      .max(2)
      .refine((scopes) => scopes.includes('task:read') && new Set(scopes).size === scopes.length),
    audiences: z
      .array(z.enum(['api', 'mcp']))
      .min(1)
      .max(2)
      .refine((items) => new Set(items).size === items.length),
    expiresInDays: z.number().int().min(1).max(30).default(1),
  })
  .refine(
    (input) => Boolean(input.projectId) !== Boolean(input.projectIds),
    'Choose projectId or projectIds',
  );
export const existingAgentCredentialSchema = z.strictObject({
  label: z.string().trim().min(1).max(120),
  scopes: agentScopesSchema,
  audiences: z
    .array(z.enum(['api', 'mcp']))
    .min(1)
    .max(2)
    .refine((values) => new Set(values).size === values.length),
  expiresInDays: z.number().int().min(1).max(30).default(1),
});
export const agentMembershipSchema = z.strictObject({
  active: z.boolean(),
  scopes: agentScopesSchema,
  expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
