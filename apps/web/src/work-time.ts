export type TaskWorkTime = {
  asOf: string;
  timeZone: string;
  totalMilliseconds: string;
  agents: { principalId: string; agentName: string; ownerUserId: string; milliseconds: string }[];
  days: {
    date: string;
    principalId: string;
    agentName: string;
    ownerUserId: string;
    milliseconds: string;
  }[];
  intervals: {
    id: string;
    principalId: string;
    agentName: string;
    ownerUserId: string;
    sessionId: string;
    workRevision: number;
    startedAt: string;
    endedAt: string | null;
    effectiveEnd: string;
    validUntil: string;
    milliseconds: string;
    state: 'RUNNING' | 'CLOSED' | 'EXPIRED';
    closeReason: string | null;
  }[];
};
export function formatWorkDuration(milliseconds: string) {
  const seconds = BigInt(milliseconds) / 1000n,
    hours = seconds / 3600n,
    minutes = (seconds % 3600n) / 60n,
    remainder = seconds % 60n;
  return hours > 0n
    ? `${hours} h ${minutes} min ${remainder} s`
    : minutes > 0n
      ? `${minutes} min ${remainder} s`
      : `${remainder} s`;
}
