import { z } from 'zod';
import { taskStatusSchema, eventEnvelopeSchema, sequenceSchema } from '@acc/contracts';

const id = z.uuid(),
  version = z.number().int().positive(),
  date = z.iso.datetime({ offset: true });
const names = z.looseObject({ id, name: z.string() });
const project = names.extend({ archived: z.boolean(), claimsPaused: z.boolean() });
const member = names.extend({ active: z.boolean(), version, scopes: z.array(z.string()) });
const credential = z.looseObject({
  id,
  label: z.string(),
  scopes: z.array(z.string()),
  audiences: z.array(z.string()),
  expiresAt: date,
  revokedAt: date.nullable(),
});
const agent = z.looseObject({
  id,
  name: z.string(),
  ownerUserId: id,
  ownerUsername: z.string(),
  projects: z.array(member),
  credentials: z.array(credential),
});
const user = z.looseObject({
  id,
  username: z.string(),
  displayName: z.string(),
  systemRole: z.enum(['ADMIN', 'USER']),
  mustChangePassword: z.boolean(),
});
const task = z.looseObject({
  id,
  publicId: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  version,
  workRevision: version,
  workType: z.enum(['CODE', 'OTHER']),
});
const validation = z.looseObject({
  id,
  workRevision: version,
  completionVersion: version,
  principalId: id,
  note: z.string(),
  createdAt: date,
  current: z.boolean(),
});
const session = z.looseObject({
  id,
  principalId: id,
  version,
  expiresAt: date,
  endedAt: date.nullable(),
});
const issued = credential.omit({ revokedAt: true }).extend({
  token: z.string().meta({ description: 'Secreto mostrado una sola vez; no aparece en listados.' }),
  principalId: id,
  ownerUserId: id,
});
const mutation = z.looseObject({ version, projectSeq: sequenceSchema.optional() }).meta({
  description:
    'Resultado de comando. Los campos adicionales dependen de la operación (id, estado, revisión, lease o procedencia).',
});
const requirement = z.looseObject({
  id,
  publicId: z.string(),
  version,
  revision: version,
  approvedRevision: version.nullable(),
});
const requirementRevision = z.looseObject({
  revision: version,
  type: z.enum(['FUNCTIONAL', 'NON_FUNCTIONAL']),
  title: z.string(),
  description: z.string(),
  reason: z.string(),
  status: z.enum(['DRAFT', 'APPROVED', 'SUPERSEDED']),
  createdBy: id,
  createdAt: date,
  approvedBy: id.nullable(),
  approvedAt: date.nullable(),
});
export const responseModels = {
  RequirementMutation: requirement.extend({
    projectSeq: sequenceSchema,
    taskVersion: version.optional(),
  }),
  RequirementList: z.strictObject({
    items: z.array(
      requirement.extend({
        title: z.string(),
        type: z.enum(['FUNCTIONAL', 'NON_FUNCTIONAL']),
        status: z.enum(['DRAFT', 'APPROVED', 'SUPERSEDED']),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
  RequirementDetail: requirement.extend({
    externalRef: z.string().nullable(),
    createdBy: id,
    createdAt: date,
    revisions: z.array(requirementRevision),
    links: z.array(
      z.looseObject({
        taskId: id,
        publicId: z.string(),
        taskVersion: version,
        evaluatedRevision: version.nullable(),
        impactPending: z.boolean(),
      }),
    ),
    impactReviews: z.array(
      z.looseObject({
        id,
        taskId: id,
        revision: version,
        reason: z.string(),
        principalId: id,
        createdAt: date,
      }),
    ),
  }),
  Health: z.strictObject({ status: z.literal('UP') }),
  Csrf: z.strictObject({ csrfToken: z.string() }),
  Identity: z.looseObject({
    principal: z.looseObject({
      id,
      kind: z.enum(['HUMAN', 'AGENT']),
      ownerUserId: id.optional(),
      ownerUsername: z.string().optional(),
      agentName: z.string().optional(),
    }),
    user: user.omit({ id: true }).optional(),
    csrfToken: z.string().optional(),
  }),
  SignedOut: z.strictObject({ signedOut: z.literal(true) }),
  Projects: z.array(project),
  TaskList: z.strictObject({ items: z.array(task), nextCursor: z.string().nullable() }),
  TaskDetail: task.extend({
    summary: z.string(),
    criteria: z.array(
      z.looseObject({ id: z.string(), description: z.string(), required: z.boolean() }),
    ),
    impactPending: z.boolean(),
    requirements: z.array(
      z.looseObject({
        id,
        publicId: z.string(),
        version,
        approvedRevision: version.nullable(),
        evaluatedRevision: version.nullable(),
        impactPending: z.boolean(),
      }),
    ),
    completionVersion: version.nullable(),
    evidence: z.array(
      z.looseObject({
        id,
        kind: z.string(),
        url: z.string(),
        workRevision: version,
        acceptedBy: id.nullable(),
        commit: z.string().nullable(),
      }),
    ),
    approvals: z.array(
      z.looseObject({
        id,
        kind: z.string(),
        workRevision: version,
        principalId: id,
        invalidatedAt: date.nullable(),
      }),
    ),
    validations: z.array(validation),
    claim: z
      .looseObject({
        principalId: id,
        sessionId: id,
        expiresAt: date,
        fencingToken: z.string().nullable(),
      })
      .nullable(),
    dependencies: z.array(z.looseObject({ id, publicId: z.string(), status: taskStatusSchema })),
    projectSeq: sequenceSchema,
  }),
  Sessions: z.array(session),
  Context: z.strictObject({
    schemaVersion: z.literal(1),
    projectId: id,
    snapshotId: id,
    projectSeq: sequenceSchema,
    generatedAt: date,
    expiresAt: date,
    records: z.array(
      z.strictObject({ entityType: z.string(), data: z.record(z.string(), z.unknown()) }),
    ),
    complete: z.boolean(),
    nextCursor: z.string().nullable(),
    changesCursor: z.string().nullable(),
  }),
  Changes: z.strictObject({
    schemaVersion: z.literal(1),
    projectId: id,
    projectSeq: sequenceSchema,
    throughSeq: sequenceSchema,
    events: z.array(eventEnvelopeSchema),
    complete: z.boolean(),
    nextCursor: z.string().nullable(),
    changesCursor: z.string().nullable(),
  }),
  Mutation: mutation,
  CreatedTask: mutation.extend({ id, publicId: z.string(), status: taskStatusSchema }),
  Claim: mutation.extend({ fencingToken: z.string(), expiresAt: date }),
  SessionMutation: mutation.extend({ id, expiresAt: date.optional() }),
  ValidatedTask: mutation.extend({
    id,
    status: z.literal('DONE'),
    workRevision: version,
    completionVersion: version,
    validatedBy: id,
    validatedAt: date,
  }),
  Users: z.strictObject({
    users: z.array(
      user.extend({
        disabled: z.boolean(),
        projects: z.array(
          names.extend({ roles: z.array(z.string()), active: z.boolean(), version }),
        ),
        agents: z.array(names),
      }),
    ),
    projects: z.array(names.extend({ archived: z.boolean() })),
  }),
  CreatedUser: user,
  PasswordReset: z.strictObject({ reset: z.literal(true) }),
  UserStatus: z.strictObject({ id, disabled: z.boolean() }),
  UserMembership: z.looseObject({
    projectId: id,
    principalId: id,
    active: z.boolean(),
    roles: z.array(z.string()),
    version,
  }),
  AgentMembership: z.looseObject({
    projectId: id,
    principalId: id,
    active: z.boolean(),
    scopes: z.array(z.string()),
    version,
  }),
  Agents: z.array(agent),
  AgentCredentials: z.array(
    credential.extend({
      principalId: id,
      ownerUserId: id,
      ownerUsername: z.string(),
      agentName: z.string(),
      disabled: z.boolean(),
      projects: z.array(names.extend({ active: z.boolean() })),
    }),
  ),
  IssuedCredential: issued,
  CreatedAgent: issued.extend({ projectIds: z.array(id) }),
  Revoked: z.strictObject({ revoked: z.literal(true) }),
};
export function envelope<T extends z.ZodType>(model: T) {
  return z.strictObject({
    data: model,
    meta: z.strictObject({
      requestId: z.string(),
      version: version.optional(),
      projectSeq: sequenceSchema.optional(),
    }),
  });
}
export const errorModel = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});
