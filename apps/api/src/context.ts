import type pg from 'pg';
import type { CoordinationStore } from '@acc/db';
import type { ApiConfiguration } from './config.ts';
import type { OidcService } from './auth/oidc.ts';
import type { ProjectQueries } from './projects/queries.ts';
import type { ProjectContext } from './projects/context.ts';
export const API_RUNTIME = Symbol('API_RUNTIME');
export type ApiRuntime = {
  config: ApiConfiguration;
  pool: pg.Pool;
  store: CoordinationStore;
  auth: OidcService;
  queries: ProjectQueries;
  context: ProjectContext;
};
