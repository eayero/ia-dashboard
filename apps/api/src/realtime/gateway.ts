import type { Server as HttpServer } from 'node:http';
import type { RequestHandler } from 'express';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import type { ApiRuntime } from '../context.ts';
import type { ApiRequest } from '../auth/types.ts';
import { ApiError } from '../common/errors.ts';
import { RealtimeStreams } from './streams.ts';

const subscription = z.strictObject({ projectId: z.uuid() });
type Peer = { request: ApiRequest; projectId: string; principalId: string };

export function mountRealtime(server: HttpServer, runtime: ApiRuntime, session: RequestHandler) {
  const io = new Server(server, {
    path: '/ws/v1',
    serveClient: false,
    transports: ['websocket'],
    maxHttpBufferSize: 8192,
    connectTimeout: 5000,
    allowRequest: (request, done) =>
      done(
        null,
        request.headers.origin === runtime.config.publicOrigin && io.engine.clientsCount < 200,
      ),
  });
  io.engine.use(session);
  const peers = new Map<Socket, Peer>();
  const streams = runtime.config.redisUrl
    ? new RealtimeStreams(runtime.config.redisUrl)
    : undefined;
  const degraded = new Set<string>();
  let closed = false,
    polling = false,
    checking = false;
  const requestFor = (socket: Socket) => {
    const request = socket.request as ApiRequest;
    request.get = ((name: string) => request.headers[name.toLowerCase()]) as ApiRequest['get'];
    return request;
  };
  async function authorize(request: ApiRequest, projectId: string, reload = false) {
    if (reload && !request.get('authorization')) {
      await new Promise<void>((resolve, reject) =>
        request.session.reload((error) =>
          error ? reject(new ApiError(401, 'AUTH_REQUIRED')) : resolve(),
        ),
      );
    }
    const identity = await runtime.auth.authenticate(request);
    if (identity.user?.mustChangePassword) throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED');
    if (identity.mode === 'BEARER' && !identity.scopes.includes('task:read'))
      throw new ApiError(403, 'FORBIDDEN');
    await runtime.queries.inProject(projectId, identity.id, async () => undefined);
    return identity;
  }
  const failure = (error: unknown) => ({
    code: error instanceof ApiError ? error.code : 'REALTIME_UNAVAILABLE',
    status: error instanceof ApiError ? error.status : 503,
  });
  function revoke(socket: Socket, error: unknown) {
    if (!socket.connected) return;
    socket.emit('acc:access-lost', failure(error));
    socket.disconnect(true);
  }
  io.use(async (socket, next) => {
    try {
      const parsed = subscription.safeParse(socket.handshake.auth);
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR');
      const { projectId } = parsed.data;
      const request = requestFor(socket);
      const identity = await authorize(request, projectId);
      if ([...peers.values()].filter((p) => p.principalId === identity.id).length >= 8)
        throw new ApiError(429, 'REALTIME_LIMIT');
      socket.data.peer = { request, projectId, principalId: identity.id } satisfies Peer;
      next();
    } catch (error) {
      const denied = new Error('REALTIME_REJECTED') as Error & { data: ReturnType<typeof failure> };
      denied.data = failure(error);
      next(denied);
    }
  });
  io.on('connection', async (socket) => {
    const peer = socket.data.peer as Peer;
    peers.set(socket, peer);
    socket.once('disconnect', () => {
      peers.delete(socket);
      if (![...peers.values()].some((p) => p.projectId === peer.projectId)) {
        streams?.forget(peer.projectId);
        degraded.delete(peer.projectId);
      }
    });
    await socket.join(`project:${peer.projectId}`);
    await socket.join(`agent:${peer.principalId}`);
    try {
      await streams?.subscribe(peer.projectId);
    } catch {
      degraded.add(peer.projectId);
    }
    if (!socket.connected || closed) return;
    try {
      await authorize(peer.request, peer.projectId, true);
    } catch (error) {
      revoke(socket, error);
      return;
    }
    socket.emit('acc:ready', { projectId: peer.projectId, principalId: peer.principalId });
  });
  // Recheck idle connections independently of Redis health and event traffic.
  const authTimer = setInterval(async () => {
    if (checking || closed) return;
    checking = true;
    try {
      await Promise.all(
        [...peers].map(async ([socket, peer]) => {
          try {
            await authorize(peer.request, peer.projectId, true);
          } catch (error) {
            revoke(socket, error);
          }
        }),
      );
    } finally {
      checking = false;
    }
  }, 1000);
  const eventTimer = setInterval(async () => {
    if (polling || closed || !streams) return;
    polling = true;
    try {
      for (const projectId of new Set([...peers.values()].map((p) => p.projectId))) {
        try {
          const batch = await streams.read(projectId);
          const resync = batch.resync || degraded.delete(projectId);
          if (!batch.events.length && !resync) continue;
          await Promise.all(
            [...peers]
              .filter(([, p]) => p.projectId === projectId)
              .map(async ([socket, peer]) => {
                try {
                  await authorize(peer.request, projectId, true);
                  if (!socket.connected) return;
                  if (!socket.conn.transport.writable) {
                    socket.disconnect(true);
                    return;
                  }
                  if (resync) socket.emit('acc:resync', { projectId });
                  for (const event of batch.events) socket.emit('acc:event', event);
                } catch (error) {
                  revoke(socket, error);
                }
              }),
          );
        } catch {
          if (!degraded.has(projectId))
            for (const [socket, peer] of peers)
              if (peer.projectId === projectId) socket.emit('acc:resync', { projectId });
          degraded.add(projectId);
        }
      }
    } finally {
      polling = false;
    }
  }, 250);
  authTimer.unref();
  eventTimer.unref();
  const close = () => {
    closed = true;
    clearInterval(authTimer);
    clearInterval(eventTimer);
    streams?.close();
    io.disconnectSockets(true);
    io.engine.close();
  };
  server.once('close', close);
  return { close };
}
