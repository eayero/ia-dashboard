import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express, { type ErrorRequestHandler, type NextFunction, type Response } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type pg from 'pg';
import { CoordinationStore } from '@acc/db';
import type { ApiConfiguration } from './config.ts';
import { API_RUNTIME, type ApiRuntime } from './context.ts';
import { ApiExceptionFilter, sendError } from './common/errors.ts';
import { AuthService } from './auth/service.ts';
import { AuthenticationGuard } from './auth/guard.ts';
import { AuthController } from './auth/controller.ts';
import { ProjectsController } from './projects/controller.ts';
import { ProjectQueries } from './projects/queries.ts';
import { ProjectContext } from './projects/context.ts';
import { HealthController } from './health/controller.ts';
import type { ApiRequest } from './auth/types.ts';
import { mountMcp } from './mcp/gateway.ts';
import { AccountAdministration } from './auth/admin.ts';
import { AccountsController, UserAgentsController } from './auth/admin-controller.ts';
import { mountRealtime } from './realtime/gateway.ts';
import { OpenApiController } from './openapi/controller.ts';

export const API_CONTROLLERS = [
  AuthController,
  ProjectsController,
  HealthController,
  AccountsController,
  UserAgentsController,
  OpenApiController,
];

export async function createApplication(config: ApiConfiguration, pool: pg.Pool) {
  await pool.query('SELECT 1');
  await pool.query(
    'SELECT u.credential_version,t.token_hash,h.sid,m.active,s.version,c.seq,v.completion_version,a.owner_user_id FROM local_users u CROSS JOIN agent_credentials t CROSS JOIN http_sessions h CROSS JOIN project_members m CROSS JOIN agent_sessions s CROSS JOIN context_snapshots c CROSS JOIN task_validations v CROSS JOIN agent_profiles a LIMIT 0',
  );
  const queries = new ProjectQueries(pool, config.sessionSecret);
  const runtime: ApiRuntime = {
    config,
    pool,
    store: new CoordinationStore(pool),
    auth: new AuthService(config, pool),
    queries,
    context: new ProjectContext(queries, config.sessionSecret),
    accounts: new AccountAdministration(pool),
  };
  @Module({
    controllers: API_CONTROLLERS,
    providers: [
      { provide: API_RUNTIME, useValue: runtime },
      AuthenticationGuard,
      { provide: 'REALTIME_SHUTDOWN', useValue: { onModuleDestroy: () => realtime?.close() } },
    ],
  })
  class ApiModule {}
  const app = await NestFactory.create(ApiModule, {
    bodyParser: false,
    logger: false,
    abortOnError: false,
  });
  const instance = app.getHttpAdapter().getInstance() as express.Express;
  instance.disable('x-powered-by');
  // Only loopback reverse proxies may supply forwarding headers.
  instance.set('trust proxy', 'loopback');
  app.use((req: ApiRequest, res: Response, next: NextFunction) => {
    req.requestId = randomUUID();
    res.setHeader('x-request-id', req.requestId);
    res.setHeader('cache-control', 'no-store');
    next();
  });
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' } }));
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (req, res) =>
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: 'RATE_LIMITED',
            requestId: (req as ApiRequest).requestId,
          },
        }),
    }),
  );
  app.use(express.json({ limit: '32kb', strict: true }));
  const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) =>
    sendError(error, req as ApiRequest, res);
  instance.use(errorHandler);
  const PgStore = connectPgSimple(session);
  const schema = (await pool.query<{ name: string }>('SELECT current_schema() AS name')).rows[0]!
    .name;
  const sessionStore = new PgStore({
    pool,
    schemaName: schema,
    tableName: 'http_sessions',
    createTableIfMissing: false,
    pruneSessionInterval: 60,
    errorLog: () => console.error('HTTP session store error'),
  });
  const sessionMiddleware = session({
    name: 'acc.sid',
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      httpOnly: true,
      secure: config.secureCookie,
      sameSite: 'lax',
      path: '/',
      maxAge: 5 * 60 * 1000,
    },
  });
  app.use(sessionMiddleware);
  mountMcp(instance, runtime);
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  const server = app.getHttpServer() as Server;
  const realtime = mountRealtime(server, runtime, sessionMiddleware);
  server.once('close', () => {
    void sessionStore.close();
  });
  return app;
}
