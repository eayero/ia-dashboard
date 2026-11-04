import type pg from 'pg';
import type { CoordinationStore } from '@acc/db';
import type { ApiConfiguration } from './config.ts';
import type { AuthService } from './auth/service.ts';
import type { ProjectQueries } from './projects/queries.ts';
import type { ProjectContext } from './projects/context.ts';
import type { AccountAdministration } from './auth/admin.ts';
export const API_RUNTIME = Symbol('API_RUNTIME');
export type ApiRuntime = {
  config: ApiConfiguration;
  pool: pg.Pool;
  store: CoordinationStore;
  auth: AuthService;
  queries: ProjectQueries;
  context: ProjectContext;
  accounts: AccountAdministration;
};
