import type express from 'express';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ApiRuntime } from '../context.ts';
import type { ApiRequest } from '../auth/types.ts';
import { ApiError, sendError } from '../common/errors.ts';
import { createMcpServer } from './tools.ts';

export function mountMcp(app: express.Express, runtime: ApiRuntime) {
  const resource = `${runtime.config.publicOrigin}/mcp`;
  const metadata = `${runtime.config.publicOrigin}/.well-known/oauth-protected-resource/mcp`;
  app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
    res.json({
      resource,
      bearer_methods_supported: ['header'],
      scopes_supported: ['task:read', 'task:write'],
    });
  });
  app.all('/mcp', async (request, res) => {
    const req = request as ApiRequest;
    let server: Server | undefined;
    try {
      if (req.get('origin') && req.get('origin') !== runtime.config.publicOrigin)
        throw new ApiError(403, 'ORIGIN_FORBIDDEN');
      if (!req.get('authorization')) throw new ApiError(401, 'AUTH_REQUIRED');
      req.identity = await runtime.auth.authenticate(req, resource);
      if (!req.identity.scopes.includes('task:read')) {
        res.setHeader(
          'www-authenticate',
          `Bearer error="insufficient_scope", scope="task:read", resource_metadata="${metadata}"`,
        );
        throw new ApiError(403, 'FORBIDDEN');
      }
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST');
        res.status(405).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'METHOD_NOT_ALLOWED' },
        });
        return;
      }
      const handler = createMcpServer(runtime, req);
      server = handler.server;
      if (!req.identity.scopes.includes(handler.requiredScope(req.body))) {
        res.setHeader(
          'www-authenticate',
          `Bearer error="insufficient_scope", scope="task:read task:write", resource_metadata="${metadata}"`,
        );
        throw new ApiError(403, 'FORBIDDEN');
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const active = server;
      res.once('close', () => {
        void active.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        if (error instanceof ApiError && error.status === 401)
          res.setHeader('www-authenticate', `Bearer resource_metadata="${metadata}"`);
        sendError(error, req, res);
      }
      if (server) await server.close();
    }
  });
}
