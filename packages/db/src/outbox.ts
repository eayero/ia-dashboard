import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { EventEnvelope } from '@acc/contracts';
import { eventFromRow, type AuditEventRow } from './events.ts';

export type OutboxClaim = { claimToken: string; event: EventEnvelope };
export class OutboxStore {
  private pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }
  async claimNext(): Promise<OutboxClaim | null> {
    const claimToken = randomUUID();
    const result = await this.pool.query<AuditEventRow & { claim_token: string }>(
      `WITH candidate AS (
      SELECT event_id FROM event_outbox WHERE published_at IS NULL
        AND next_attempt_at<=clock_timestamp() AND (locked_until IS NULL OR locked_until<=clock_timestamp())
      ORDER BY created_at,event_id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE event_outbox o SET claim_token=$1,locked_until=clock_timestamp()+interval '15 seconds',attempts=o.attempts+1
      FROM candidate c,audit_events e WHERE o.event_id=c.event_id AND e.id=o.event_id
      RETURNING e.*,o.claim_token`,
      [claimToken],
    );
    if (!result.rows[0]) return null;
    return { claimToken: result.rows[0].claim_token, event: eventFromRow(result.rows[0]) };
  }
  async markPublished(claim: OutboxClaim): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE event_outbox SET published_at=clock_timestamp(),claim_token=NULL,locked_until=NULL,last_error_code=NULL
      WHERE event_id=$1 AND claim_token=$2 AND locked_until>clock_timestamp() AND published_at IS NULL`,
      [claim.event.eventId, claim.claimToken],
    );
    return result.rowCount === 1;
  }
  async markFailed(claim: OutboxClaim): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE event_outbox SET claim_token=NULL,locked_until=NULL,last_error_code='OUTBOX_DELIVERY_FAILED',
      next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(60::double precision,power(2::double precision,LEAST(attempts-1,6))))
      WHERE event_id=$1 AND claim_token=$2 AND locked_until>clock_timestamp() AND published_at IS NULL`,
      [claim.event.eventId, claim.claimToken],
    );
    return result.rowCount === 1;
  }
  async cleanupExpiredSnapshots(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('Invalid cleanup limit');
    const result = await this.pool.query(
      `WITH expired AS (
      SELECT id FROM context_snapshots WHERE expires_at<=clock_timestamp() ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT $1
    ) DELETE FROM context_snapshots s USING expired e WHERE s.id=e.id RETURNING s.id`,
      [limit],
    );
    return result.rowCount ?? 0;
  }
}
