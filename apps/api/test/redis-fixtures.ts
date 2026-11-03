import { createClient } from 'redis';
export function redisInspector(url: string) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: { connectTimeout: 2000, reconnectStrategy: false },
  });
  client.on('error', () => {});
  return client;
}
