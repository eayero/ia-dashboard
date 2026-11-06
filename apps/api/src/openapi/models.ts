import { z } from 'zod';
import { taskStatusSchema, eventEnvelopeSchema, sequenceSchema } from '@acc/contracts';
import { iterationStatusSchema } from '@acc/contracts';

const id = z.uuid(),
  version = z.number().int().positive(),
  date = z.iso.datetime({ offset: true });
const names = z.looseObject({ id, name: z.string() });
const creator = z.looseObject({
  principalId: id,
  createdAt: date,
  identity: z.record(z.string(), z.unknown()).nullable(),
  channel: z.enum(['UNKNOWN', 'MCP', 'WEB', 'API']),
});
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
const governanceBase = z.looseObject({
  id,
  publicId: z.string(),
  version,
  createdBy: id,
  createdAt: date,
  creatorIdentity: z.record(z.string(), z.unknown()).nullable(),
});
const questionFields = {
  title: z.string(),
  description: z.string(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']),
  status: z.enum(['OPEN', 'RESOLVED', 'CANCELLED']),
};
const governanceTask = z.looseObject({
  taskId: id,
  publicId: z.string(),
  title: z.string(),
  taskVersion: version,
  status: taskStatusSchema,
});
const governanceRequirements = z.array(z.looseObject({ id, publicId: z.string() }));
const questionSummary = governanceBase.extend(questionFields);
const decisionSummary = governanceBase.extend({
  title: z.string(),
  status: z.enum(['DRAFT', 'APPROVED', 'SUPERSEDED']),
  revision: version,
  approvedRevision: version.nullable(),
});
export const responseModels = {
  QuestionList: z.strictObject({
    items: z.array(questionSummary),
    nextCursor: z.string().nullable(),
  }),
  DecisionList: z.strictObject({
    items: z.array(decisionSummary),
    nextCursor: z.string().nullable(),
  }),
  QuestionDetail: governanceBase.extend({
    ...questionFields,
    externalRef: z.string().nullable(),
    acceptedAnswerId: id.nullable(),
    tasks: z.array(governanceTask.extend({ hard: z.boolean() })),
    requirements: governanceRequirements,
    answers: z.array(
      z.looseObject({
        id,
        text: z.string(),
        createdBy: id,
        createdAt: date,
        creatorIdentity: z.record(z.string(), z.unknown()).nullable(),
      }),
    ),
    resolutions: z.array(
      z.looseObject({
        id,
        answerId: id.nullable(),
        action: z.enum(['RESOLVE', 'REOPEN', 'CANCEL']),
        reason: z.string(),
        principalId: id,
        createdAt: date,
      }),
    ),
  }),
  DecisionDetail: governanceBase.extend({
    externalRef: z.string().nullable(),
    revision: version,
    approvedRevision: version.nullable(),
    tasks: z.array(governanceTask.extend({ evaluatedRevision: version.nullable() })),
    requirements: governanceRequirements,
    revisions: z.array(
      z.looseObject({
        revision: version,
        title: z.string(),
        context: z.string(),
        alternatives: z.array(z.string()),
        choice: z.string(),
        rationale: z.string(),
        reason: z.string(),
        status: z.enum(['DRAFT', 'APPROVED', 'SUPERSEDED']),
        createdBy: id,
        createdAt: date,
        approvedBy: id.nullable(),
        approvedAt: date.nullable(),
      }),
    ),
    questions: z.array(
      z.looseObject({
        id,
        publicId: z.string(),
        title: z.string(),
        status: z.enum(['OPEN', 'RESOLVED', 'CANCELLED']),
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
  GovernanceMutation: z.looseObject({
    id,
    version,
    publicId: z.string().optional(),
    answerId: id.optional(),
    taskVersion: version.optional(),
    revision: version.optional(),
    approvedRevision: version.nullable().optional(),
    projectSeq: sequenceSchema.optional(),
  }),
  IterationList: z.strictObject({
    items: z.array(
      z.looseObject({
        id,
        publicId: z.string(),
        name: z.string(),
        goal: z.string(),
        startsOn: z.iso.date(),
        endsOn: z.iso.date(),
        status: iterationStatusSchema,
        version,
        requirementCount: z.number().int().nonnegative(),
        taskCount: z.number().int().nonnegative(),
        pendingTasks: z.number().int().nonnegative(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
  PlanningMutation: z.looseObject({
    id: id.optional(),
    version: version.optional(),
    projectSeq: sequenceSchema.optional(),
    tasksStopped: z.number().int().optional(),
  }),
  Participants: z.looseObject({
    creator: z.looseObject({
      principalId: id,
      createdAt: date,
      identity: z.record(z.string(), z.unknown()).nullable(),
      channel: z.string(),
    }),
    participants: z.array(
      z.looseObject({
        principalId: id,
        identity: z.record(z.string(), z.unknown()).nullable(),
        firstAt: date.nullable(),
        lastAt: date.nullable(),
        actionCount: z.number().int().nonnegative(),
        channels: z.array(z.string()),
        milliseconds: z.string(),
      }),
    ),
    taskCollaborators: z.array(z.record(z.string(), z.unknown())),
    owners: z.array(z.strictObject({ ownerUserId: id, milliseconds: z.string() })),
    totalMilliseconds: z.string(),
    asOf: date,
    timeZone: z.string(),
    work: z.array(z.record(z.string(), z.unknown())),
  }),
  RepositoryList: z.strictObject({
    items: z.array(z.strictObject({ id, name: z.string(), url: z.url() })),
    nextCursor: z.string().nullable(),
  }),
  RepositoryMutation: z.strictObject({
    id,
    name: z.string(),
    url: z.url(),
    projectSeq: sequenceSchema,
  }),
  TaskTime: z.strictObject({
    asOf: date,
    timeZone: z.string(),
    totalMilliseconds: z.string().regex(/^\d+$/u),
    agents: z.array(
      z.strictObject({
        principalId: id,
        agentName: z.string(),
        ownerUserId: id,
        milliseconds: z.string(),
      }),
    ),
    days: z.array(
      z.strictObject({
        date: z.string(),
        principalId: id,
        agentName: z.string(),
        ownerUserId: id,
        milliseconds: z.string(),
      }),
    ),
    intervals: z.array(
      z.strictObject({
        id,
        principalId: id,
        agentName: z.string(),
        ownerUserId: id,
        sessionId: id,
        workRevision: version,
        startedAt: date,
        endedAt: date.nullable(),
        effectiveEnd: date,
        validUntil: date,
        milliseconds: z.string(),
        state: z.enum(['RUNNING', 'CLOSED', 'EXPIRED']),
        closeReason: z.string().nullable(),
      }),
    ),
  }),
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
    creator,
    sprintId: id.nullable(),
    sprint: z
      .looseObject({ id, publicId: z.string(), name: z.string(), status: iterationStatusSchema })
      .nullable(),
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
    creator,
    primaryRequirementId: id.nullable(),
    sprintId: id.nullable(),
    sprintName: z.string().nullable(),
    sprintPublicId: z.string().nullable(),
    sprintStatus: iterationStatusSchema.nullable(),
    executionBlock: z
      .enum(['PRIMARY_REQUIREMENT_REQUIRED', 'SPRINT_REQUIRED', 'SPRINT_NOT_ACTIVE'])
      .nullable(),
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
