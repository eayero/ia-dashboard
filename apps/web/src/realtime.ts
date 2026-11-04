import { io } from 'socket.io-client';
import { eventEnvelopeSchema } from '@acc/contracts';

export function realtimeHandlers(
  projectId: string,
  refresh: () => void,
  accessLost: (status: number) => void,
) {
  const seen = new Set<string>();
  const matches = (value: unknown) =>
    !!value && typeof value === 'object' && 'projectId' in value && value.projectId === projectId;
  return {
    ready(value: unknown) {
      if (matches(value)) {
        seen.clear();
        refresh();
      }
    },
    resync(value: unknown) {
      if (matches(value)) refresh();
    },
    event(value: unknown) {
      const parsed = eventEnvelopeSchema.safeParse(value);
      if (!parsed.success || parsed.data.projectId !== projectId || seen.has(parsed.data.eventId))
        return;
      seen.add(parsed.data.eventId);
      if (seen.size > 256) seen.delete(seen.values().next().value!);
      // A late event can still represent a relevant update. REST orders the durable delta.
      refresh();
    },
    denied(value: unknown) {
      if (
        value &&
        typeof value === 'object' &&
        'status' in value &&
        (value.status === 401 || value.status === 403)
      )
        accessLost(value.status);
    },
  };
}

export function watchProject(
  projectId: string,
  refresh: () => void,
  accessLost: (status: number) => void,
) {
  const handlers = realtimeHandlers(projectId, refresh, accessLost);
  let closed = false,
    denied = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const socket = io(window.location.origin, {
    path: '/ws/v1',
    transports: ['websocket'],
    auth: { projectId },
    withCredentials: true,
    autoConnect: false,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 5000,
  });
  socket.on('acc:ready', handlers.ready);
  socket.on('acc:resync', handlers.resync);
  socket.on('acc:event', handlers.event);
  socket.on('acc:access-lost', (value) => {
    denied = value?.status === 401 || value?.status === 403;
    handlers.denied(value);
    socket.disconnect();
  });
  socket.on('connect_error', (error) =>
    handlers.denied((error as Error & { data?: unknown }).data),
  );
  socket.on('disconnect', (reason) => {
    refresh();
    // Socket.IO retries transport failures itself, but a server disconnect is explicit.
    if (!closed && !denied && reason === 'io server disconnect')
      reconnectTimer = setTimeout(() => {
        if (!closed) socket.connect();
      }, 1000);
  });
  const offline = () => socket.disconnect();
  const online = () => {
    if (!closed && !denied) socket.connect();
  };
  window.addEventListener('offline', offline);
  window.addEventListener('online', online);
  socket.connect();
  return () => {
    closed = true;
    clearTimeout(reconnectTimer);
    window.removeEventListener('offline', offline);
    window.removeEventListener('online', online);
    socket.removeAllListeners();
    socket.disconnect();
  };
}
