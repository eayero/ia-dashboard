import type { EventEnvelope } from '@acc/contracts';
import type { OutboxStore } from '@acc/db';
export interface EventSink {
  publish(event: EventEnvelope): Promise<void>;
}
export class OutboxWorker {
  constructor(
    private store: OutboxStore,
    private sink: EventSink,
  ) {}
  async processOne(): Promise<'idle' | 'published' | 'failed' | 'leaseLost'> {
    const claim = await this.store.claimNext();
    if (!claim) return 'idle';
    try {
      await this.sink.publish(claim.event);
      return (await this.store.markPublished(claim)) ? 'published' : 'leaseLost';
    } catch {
      return (await this.store.markFailed(claim)) ? 'failed' : 'leaseLost';
    }
  }
}
