import { createClient } from 'redis';
import { eventEnvelopeSchema, type EventEnvelope } from '@acc/contracts';

/** Independent cursors per API process: every instance must see every event. */
export class RealtimeStreams {
  private client;
  private connecting: Promise<void> | undefined;
  private cursors = new Map<string, string>();
  constructor(url: string) {
    this.client = createClient({
      url,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 8,
      commandOptions: { timeout: 1000 },
      socket: { connectTimeout: 1000, socketTimeout: 1000, reconnectStrategy: false },
    });
    this.client.on('error', () => {});
  }
  private async ready() {
    if (this.client.isReady) return;
    this.connecting ??= this.client
      .connect()
      .then(() => {})
      .finally(() => {
        this.connecting = undefined;
      });
    await this.connecting;
  }
  async subscribe(projectId: string) {
    if (this.cursors.has(projectId)) return;
    await this.ready();
    const latest = await this.client.xRevRange(`acc:events:${projectId}`, '+', '-', { COUNT: 1 });
    // Another subscription may have initialized this cursor while we awaited Redis.
    if (!this.cursors.has(projectId)) this.cursors.set(projectId, latest?.[0]?.id ?? '0-0');
  }
  async read(projectId: string): Promise<{ events: EventEnvelope[]; resync: boolean }> {
    if (!this.cursors.has(projectId)) {
      await this.subscribe(projectId);
      return { events: [], resync: true };
    }
    await this.ready();
    const result = await this.client.xRead(
      { key: `acc:events:${projectId}`, id: this.cursors.get(projectId)! },
      { COUNT: 100 },
    );
    const events: EventEnvelope[] = [];
    let resync = false;
    for (const stream of result ?? [])
      for (const entry of stream.messages) {
        this.cursors.set(projectId, entry.id);
        try {
          const event = eventEnvelopeSchema.parse(JSON.parse(entry.message.event ?? ''));
          if (event.projectId !== projectId) {
            resync = true;
            continue;
          }
          // Match the public REST envelope, never distribute ownership fencing tokens.
          delete event.payload.fencingToken;
          events.push(event);
        } catch {
          resync = true;
        }
      }
    return { events, resync };
  }
  forget(projectId: string) {
    this.cursors.delete(projectId);
  }
  close() {
    this.cursors.clear();
    if (this.client.isOpen) this.client.destroy();
  }
}
