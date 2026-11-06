import {
  claimTaskSchema,
  heartbeatClaimSchema,
  revokeClaimSchema,
  updateWorkSchema,
  reviseTaskSchema,
  transitionTaskSchema,
  addEvidenceSchema,
  acceptEvidenceSchema,
  approveTaskSchema,
  validateTaskSchema,
  dependencySchema,
  sessionHeartbeatSchema,
  startWorkSchema,
  pauseWorkSchema,
  assignPrimaryRequirementSchema,
} from '@acc/contracts';

// Runtime dispatch and OpenAPI share this inventory and the actual input schemas.
export const taskCommands = {
  'primary-requirement': {
    method: 'assignPrimaryRequirement',
    schema: assignPrimaryRequirementSchema,
    human: true,
  },
  'start-work': { method: 'startWork', schema: startWorkSchema, agent: true },
  'pause-work': { method: 'pauseWork', schema: pauseWorkSchema, agent: true },
  claim: { method: 'claimTask', schema: claimTaskSchema },
  heartbeat: { method: 'heartbeatClaim', schema: heartbeatClaimSchema },
  release: { method: 'releaseClaim', schema: heartbeatClaimSchema },
  revoke: { method: 'revokeClaim', schema: revokeClaimSchema, human: true },
  work: { method: 'updateWork', schema: updateWorkSchema },
  revise: { method: 'reviseTask', schema: reviseTaskSchema, human: true },
  transition: { method: 'transitionTask', schema: transitionTaskSchema },
  evidence: { method: 'addEvidence', schema: addEvidenceSchema },
  'accept-evidence': { method: 'acceptEvidence', schema: acceptEvidenceSchema, human: true },
  approve: { method: 'approveTask', schema: approveTaskSchema, human: true },
  validate: { method: 'validateTask', schema: validateTaskSchema, human: true },
  dependency: { method: 'changeDependency', schema: dependencySchema, human: true },
} as const;
export const sessionCommands = {
  heartbeat: { method: 'heartbeatSession', schema: sessionHeartbeatSchema },
  end: { method: 'endSession', schema: revokeClaimSchema },
} as const;
