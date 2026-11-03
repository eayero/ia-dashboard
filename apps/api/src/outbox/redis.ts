import { createClient } from 'redis';
import { eventEnvelopeSchema, type EventEnvelope } from '@acc/contracts';
import type { EventSink } from './worker.ts';

const publishScript = `local id=redis.call('XADD',KEYS[1],'MAXLEN','~',10000,'*','event',ARGV[1])
redis.call('EXPIRE',KEYS[1],604800)
return id`;
export class RedisEventSink implements EventSink {
  private client;
  private connecting: Promise<void> | undefined;
  constructor(url: string) {
    this.client = createClient({
      url,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 8,
      commandOptions: { timeout: 2000 },
      socket: { connectTimeout: 2000, socketTimeout: 2000, reconnectStrategy: false },
    });
    // Connection failures are reported to the worker without logging URL/credentials.
    this.client.on('error', () => {});
  }
  async publish(event: EventEnvelope): Promise<void> {
    const parsed = eventEnvelopeSchema.parse(event);
    if (!this.client.isReady) {
      this.connecting ??= this.client
        .connect()
        .then(() => {})
        .finally(() => {
          this.connecting = undefined;
        });
      await this.connecting;
    }
    await this.client.sendCommand([
      'EVAL',
      publishScript,
      '1',
      `acc:events:${parsed.projectId}`,
      JSON.stringify(parsed),
    ]);
  }
  close(): void {
    if (this.client.isOpen) this.client.destroy();
  }
}
