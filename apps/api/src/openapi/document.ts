import { z } from 'zod';
import * as contracts from '@acc/contracts';
import { taskCommands, sessionCommands } from '../projects/commands.ts';
import { responseModels, envelope, errorModel } from './models.ts';

type Schema = Record<string, unknown>;
type Access = 'public' | 'cookie' | 'either' | 'agent';
type Parameter = {
  name: string;
  in: 'path' | 'header' | 'query';
  required: boolean;
  schema: Schema;
  description?: string;
};
export type Operation = {
  operationId: string;
  summary: string;
  tags: string[];
  description: string;
  security: Record<string, string[]>[];
  parameters: Parameter[];
  requestBody?: { required: boolean; content: { 'application/json': { schema: Schema } } };
  responses: Record<
    string,
    { description: string; content: { 'application/json': { schema: Schema } } }
  >;
};
type Definition = {
  path: string;
  method: 'get' | 'post';
  operationId: string;
  summary: string;
  tag: string;
  access?: Access;
  body?: z.ZodType;
  response?: keyof typeof responseModels;
  idempotent?: boolean;
  description?: string;
  query?: 'tasks' | 'context' | 'events' | 'requirements' | 'repositories';
  timeZoneQuery?: boolean;
};
const definitions: Definition[] = [
  {
    path: '/projects/{projectId}/repositories',
    method: 'get',
    operationId: 'listRepositories',
    summary: 'Consultar repositorios registrados del proyecto',
    tag: 'Repositorios',
    response: 'RepositoryList',
    query: 'repositories',
  },
  {
    path: '/projects/{projectId}/repositories',
    method: 'post',
    operationId: 'registerRepository',
    summary: 'Registrar o recuperar un repositorio por URL exacta',
    tag: 'Repositorios',
    access: 'cookie',
    body: contracts.registerRepositorySchema,
    response: 'RepositoryMutation',
    idempotent: true,
    description:
      'Solo humanos OWNER/ADMIN/MANAGER. URL HTTPS sin credenciales, consulta ni fragmento. Solo metadatos: no clona ni consulta la URL. Conserva el nombre inicial al recuperar una URL existente; no modifica repositorios ni evidencias.',
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/time',
    method: 'get',
    operationId: 'getTaskTime',
    summary: 'Consultar tiempo registrado por agente y día',
    tag: 'Tareas',
    response: 'TaskTime',
    timeZoneQuery: true,
    description:
      'Intervalos explícitos de agentes; UTC almacenado y zona IANA para reparto diario. Caducidad del claim/sesión limita tramos activos. No reconstruye tiempo histórico.',
  },
  {
    path: '/projects/{projectId}/requirements',
    method: 'get',
    operationId: 'listRequirements',
    summary: 'Listar requisitos versionados',
    tag: 'Requisitos',
    response: 'RequirementList',
    query: 'requirements',
  },
  {
    path: '/projects/{projectId}/requirements/{requirementId}',
    method: 'get',
    operationId: 'getRequirement',
    summary: 'Consultar revisiones, vínculos y evaluaciones de impacto',
    tag: 'Requisitos',
    response: 'RequirementDetail',
  },
  {
    path: '/projects/{projectId}/requirements',
    method: 'post',
    operationId: 'createRequirement',
    summary: 'Proponer requisito o recuperar identidad externa exacta',
    tag: 'Requisitos',
    response: 'RequirementMutation',
    body: contracts.createRequirementSchema,
    idempotent: true,
  },
  {
    path: '/projects/{projectId}/requirements/{requirementId}/revise',
    method: 'post',
    operationId: 'reviseRequirement',
    summary: 'Proponer una sucesora conservando la revisión aprobada',
    tag: 'Requisitos',
    response: 'RequirementMutation',
    body: contracts.reviseRequirementSchema,
    idempotent: true,
  },
  {
    path: '/projects/{projectId}/requirements/{requirementId}/approve',
    method: 'post',
    operationId: 'approveRequirement',
    summary: 'Aprobar revisión y marcar impacto en tareas vinculadas',
    tag: 'Requisitos',
    access: 'cookie',
    response: 'RequirementMutation',
    body: contracts.approveRequirementSchema,
    idempotent: true,
    description:
      'Solo humanos OWNER/ADMIN/MANAGER. La revisión aprobada anterior se conserva como SUPERSEDED. DONE no se reabre automáticamente.',
  },
  {
    path: '/projects/{projectId}/requirements/{requirementId}/link',
    method: 'post',
    operationId: 'linkRequirement',
    summary: 'Vincular o retirar tarea del mismo proyecto',
    tag: 'Requisitos',
    access: 'cookie',
    response: 'RequirementMutation',
    body: contracts.linkRequirementSchema,
    idempotent: true,
    description:
      'Solo humanos OWNER/ADMIN/MANAGER. Requiere versión actual del requisito y de la tarea; vincular requiere evaluación explícita.',
  },
  {
    path: '/projects/{projectId}/requirements/{requirementId}/evaluate-impact',
    method: 'post',
    operationId: 'evaluateRequirementImpact',
    summary: 'Evaluar impacto contra revisión aprobada vigente',
    tag: 'Requisitos',
    access: 'cookie',
    response: 'RequirementMutation',
    body: contracts.evaluateRequirementImpactSchema,
    idempotent: true,
    description:
      'Solo humanos OWNER/ADMIN/MANAGER. Conserva motivo e historial; otros requisitos pendientes mantienen el gate de impacto.',
  },
  {
    path: '/openapi.json',
    method: 'get',
    operationId: 'getOpenApi',
    summary: 'Descargar contrato OpenAPI',
    tag: 'Contrato',
    access: 'public',
  },
  ...['live', 'ready'].map((name) => ({
    path: `/health/${name}`,
    method: 'get' as const,
    operationId: `health${name}`,
    summary: `Health ${name}`,
    tag: 'Health',
    access: 'public' as const,
    response: 'Health' as const,
  })),
  {
    path: '/auth/session',
    method: 'get',
    operationId: 'startHttpSession',
    summary: 'Obtener cookie anónima y CSRF',
    tag: 'Autenticación',
    access: 'public',
    response: 'Csrf',
  },
  {
    path: '/auth/login',
    method: 'post',
    operationId: 'login',
    summary: 'Entrar con usuario y contraseña de ACC',
    tag: 'Autenticación',
    access: 'cookie',
    body: contracts.loginSchema,
    response: 'Identity',
    description:
      'Requiere primero GET /auth/session para cookie anónima y csrfToken. Rota cookie al autenticar; no requiere una sesión ya autenticada.',
  },
  {
    path: '/auth/me',
    method: 'get',
    operationId: 'getIdentity',
    summary: 'Consultar identidad y propietario del agente',
    tag: 'Autenticación',
    response: 'Identity',
  },
  {
    path: '/auth/password',
    method: 'post',
    operationId: 'changePassword',
    summary: 'Cambiar contraseña propia',
    tag: 'Autenticación',
    access: 'cookie',
    body: contracts.changePasswordSchema,
    response: 'Identity',
  },
  {
    path: '/auth/logout',
    method: 'post',
    operationId: 'logout',
    summary: 'Cerrar sesión HTTP',
    tag: 'Autenticación',
    access: 'cookie',
    body: contracts.emptyCommandSchema,
    response: 'SignedOut',
  },
  {
    path: '/projects',
    method: 'get',
    operationId: 'listProjects',
    summary: 'Listar proyectos autorizados',
    tag: 'Proyectos',
    response: 'Projects',
  },
  {
    path: '/projects/{projectId}/context',
    method: 'get',
    operationId: 'getContext',
    summary: 'Obtener snapshot consistente paginado',
    tag: 'Proyectos',
    response: 'Context',
    query: 'context',
    description:
      'Agotar nextCursor antes de usar changesCursor. Snapshot con TTL de diez minutos; cada página vuelve a autorizar.',
  },
  {
    path: '/projects/{projectId}/events',
    method: 'get',
    operationId: 'getChanges',
    summary: 'Leer delta ordenado de auditoría',
    tag: 'Proyectos',
    response: 'Changes',
    query: 'events',
    description:
      'Usar cursor o afterSeq, nunca ambos. Agotar nextCursor y conservar changesCursor. BIGINT decimal se conserva como string.',
  },
  {
    path: '/projects/{projectId}/tasks',
    method: 'get',
    operationId: 'listTasks',
    summary: 'Listar tareas',
    tag: 'Tareas',
    response: 'TaskList',
    query: 'tasks',
  },
  {
    path: '/projects/{projectId}/tasks',
    method: 'post',
    operationId: 'createTask',
    summary:
      'Crear tarea con requisitos obligatorios y vínculos atómicos, o recuperar referencia exacta',
    tag: 'Tareas',
    response: 'CreatedTask',
    body: contracts.createTaskSchema,
    idempotent: true,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}',
    method: 'get',
    operationId: 'getTask',
    summary: 'Consultar detalle, claim, evidencias y validaciones',
    tag: 'Tareas',
    response: 'TaskDetail',
  },
  {
    path: '/projects/{projectId}/agent-sessions',
    method: 'get',
    operationId: 'listSessions',
    summary: 'Listar sesiones de trabajo ACC',
    tag: 'Sesiones',
    response: 'Sessions',
  },
  {
    path: '/projects/{projectId}/agent-sessions',
    method: 'post',
    operationId: 'registerSession',
    summary: 'Registrar sesión de trabajo ACC',
    tag: 'Sesiones',
    response: 'SessionMutation',
    body: contracts.emptyCommandSchema,
    idempotent: true,
  },
  {
    path: '/projects/{projectId}/agents/{principalId}/revoke',
    method: 'post',
    operationId: 'revokeAgentAccess',
    summary: 'Revocar acceso de agente al proyecto',
    tag: 'Proyectos',
    access: 'cookie',
    body: contracts.revokeClaimSchema,
    response: 'Mutation',
    idempotent: true,
    description: 'Humano OWNER/ADMIN; revoca sesiones y claims del agente afectado.',
  },
  ...Object.entries(taskCommands).map(([command, definition]) => ({
    path: `/projects/{projectId}/tasks/{taskId}/${command}`,
    method: 'post' as const,
    operationId: definition.method,
    summary: `Comando de tarea: ${command}`,
    tag: 'Tareas',
    access: ('human' in definition
      ? 'cookie'
      : 'agent' in definition
        ? 'agent'
        : 'either') as Access,
    body: definition.schema,
    response: (command === 'claim' || command === 'heartbeat'
      ? 'Claim'
      : command === 'validate'
        ? 'ValidatedTask'
        : 'Mutation') as keyof typeof responseModels,
    idempotent: true,
    description:
      command === 'start-work' || command === 'pause-work'
        ? 'Solo agentes con sesión y claim propios vigentes. Inicio y pausa explícitos; el servidor calcula el tiempo y limita intervalos al lease.'
        : command === 'validate'
          ? 'Exclusivamente humano con rol de escritura en DONE. OK de auditoría ligado a finalización; no cambia estado ni revisión de trabajo.'
          : command === 'transition'
            ? 'Agente con task:write puede recorrer todos los estados válidos sin aprobación humana previa. Conserva claims, versiones, dependencias, evidencia y motivos.'
            : 'Gates, roles, versión y claim se comprueban en servidor. Accept-evidence y approve conservan compatibilidad/historial; no son gates humanos previos del flujo autónomo.',
  })),
  ...Object.entries(sessionCommands).map(([command, definition]) => ({
    path: `/projects/{projectId}/agent-sessions/{sessionId}/${command}`,
    method: 'post' as const,
    operationId: definition.method,
    summary: `Sesión de trabajo: ${command}`,
    tag: 'Sesiones',
    body: definition.schema,
    response: 'SessionMutation' as const,
    idempotent: true,
  })),
  {
    path: '/admin/users',
    method: 'get',
    operationId: 'listUsers',
    summary: 'Listar usuarios, agentes y asignaciones',
    tag: 'Administración',
    access: 'cookie',
    response: 'Users',
  },
  {
    path: '/admin/users',
    method: 'post',
    operationId: 'createUser',
    summary: 'Crear usuario con contraseña temporal',
    tag: 'Administración',
    access: 'cookie',
    body: contracts.createUserSchema,
    response: 'CreatedUser',
  },
  {
    path: '/admin/users/{id}/password',
    method: 'post',
    operationId: 'resetPassword',
    summary: 'Restablecer contraseña y revocar sesiones',
    tag: 'Administración',
    access: 'cookie',
    body: contracts.resetPasswordSchema,
    response: 'PasswordReset',
  },
  {
    path: '/admin/users/{id}/status',
    method: 'post',
    operationId: 'setUserStatus',
    summary: 'Habilitar o deshabilitar usuario',
    tag: 'Administración',
    access: 'cookie',
    body: contracts.userStatusSchema,
    response: 'UserStatus',
  },
  {
    path: '/admin/users/{id}/projects/{projectId}',
    method: 'post',
    operationId: 'setUserMembership',
    summary: 'Asignar acceso y roles de usuario',
    tag: 'Administración',
    access: 'cookie',
    body: contracts.membershipSchema,
    response: 'UserMembership',
  },
  {
    path: '/admin/agents',
    method: 'get',
    operationId: 'listAdminCredentials',
    summary: 'Listar metadatos de credenciales',
    tag: 'Administración',
    access: 'cookie',
    response: 'AgentCredentials',
  },
  {
    path: '/admin/agent-identities',
    method: 'get',
    operationId: 'listAllAgents',
    summary: 'Listar agentes de todos los usuarios',
    tag: 'Administración',
    access: 'cookie',
    response: 'Agents',
  },
  {
    path: '/admin/agents',
    method: 'post',
    operationId: 'createAdminAgent',
    summary: 'Crear agente con propietario y proyectos',
    tag: 'Administración',
    access: 'cookie',
    body: contracts.agentCredentialSchema,
    response: 'CreatedAgent',
  },
  {
    path: '/admin/agents/{id}/revoke',
    method: 'post',
    operationId: 'revokeAdminCredential',
    summary: 'Revocar credencial',
    tag: 'Administración',
    access: 'cookie',
    body: contracts.emptyCommandSchema,
    response: 'Revoked',
  },
  {
    path: '/agents',
    method: 'get',
    operationId: 'listOwnAgents',
    summary: 'Listar agentes propios',
    tag: 'Agentes',
    access: 'cookie',
    response: 'Agents',
  },
  {
    path: '/agents',
    method: 'post',
    operationId: 'createOwnAgent',
    summary: 'Crear agente propio con varios proyectos',
    tag: 'Agentes',
    access: 'cookie',
    body: contracts.agentCredentialSchema,
    response: 'CreatedAgent',
  },
  {
    path: '/agents/{id}/credentials',
    method: 'post',
    operationId: 'issueAgentCredential',
    summary: 'Emitir credencial para la misma identidad',
    tag: 'Agentes',
    access: 'cookie',
    body: contracts.existingAgentCredentialSchema,
    response: 'IssuedCredential',
  },
  {
    path: '/agents/{id}/projects/{projectId}',
    method: 'post',
    operationId: 'setAgentMembership',
    summary: 'Asignar o retirar acceso de agente al proyecto',
    tag: 'Agentes',
    access: 'cookie',
    body: contracts.agentMembershipSchema,
    response: 'AgentMembership',
  },
  {
    path: '/agents/credentials/{id}/revoke',
    method: 'post',
    operationId: 'revokeOwnCredential',
    summary: 'Revocar credencial de agente propio',
    tag: 'Agentes',
    access: 'cookie',
    body: contracts.emptyCommandSchema,
    response: 'Revoked',
  },
];

function schemaFor(schema: z.ZodType): Schema {
  const result = z.toJSONSchema(schema, { io: 'input' });
  delete result.$schema;
  for (const [name, value] of Object.entries(result.properties ?? {}))
    if (['password', 'currentPassword', 'newPassword'].includes(name) && typeof value === 'object')
      Object.assign(value, { writeOnly: true, format: 'password' });
  return result;
}
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const content = (schema: Schema) => ({ 'application/json': { schema } });
const runtimeRules =
  'Los contratos Zod de runtime son autoritativos: normalización NFC/espacios (título de 1 a 300 caracteres; descripción, resumen, motivo y nota de 1 a 4000 tras normalizar), unicidad de IDs/roles/scopes, límites BIGINT, pares sesión/fencing, projectId XOR projectIds, consistencia de pruebas y requisitos condicionales de evidencia se validan en servidor.';
export function buildOpenApi() {
  const schemas: Record<string, Schema> = { Error: schemaFor(errorModel) };
  for (const [name, model] of Object.entries(responseModels))
    schemas[name] = schemaFor(envelope(model));
  const paths: Record<string, Partial<Record<'get' | 'post', Operation>>> = {};
  for (const definition of definitions) {
    const path = '/api/v1' + definition.path,
      mutation = definition.method === 'post',
      access = definition.access ?? 'either';
    const parameters: Parameter[] = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
      name: match[1]!,
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    }));
    if (mutation) {
      parameters.push({
        name: 'Origin',
        in: 'header',
        required: access === 'cookie',
        schema: { type: 'string', format: 'uri' },
        description:
          'Obligatorio con cookie: origen público exacto. Bearer rechaza Origin ajeno si se envía.',
      });
      if (definition.idempotent)
        parameters.push({
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 200 },
          description:
            'Reusar en reintentos del mismo comando/cuerpo. Con otra intención usar una clave nueva.',
        });
    }
    if (definition.timeZoneQuery)
      parameters.push({
        name: 'timeZone',
        in: 'query',
        required: false,
        schema: { type: 'string', default: 'America/Caracas' },
        description:
          'Zona IANA válida o UTC. El reparto a medianoche conserva exactamente los totales.',
      });
    if (definition.query) {
      parameters.push({
        name: 'cursor',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          minLength: 1,
          maxLength: definition.query === 'tasks' ? 512 : 1024,
        },
      });
      parameters.push({
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        description: 'Tamaño inicial de página; cursor conserva tamaño/continuación según recurso.',
      });
      if (definition.query === 'tasks')
        parameters.push({
          name: 'status',
          in: 'query',
          required: false,
          schema: schemaFor(contracts.taskStatusSchema),
        });
      if (definition.query === 'events')
        parameters.push({
          name: 'afterSeq',
          in: 'query',
          required: false,
          schema: schemaFor(contracts.sequenceSchema),
          description: 'Decimal BIGINT entre 0 y 9223372036854775807; excluyente con cursor.',
        });
    }
    const cookieSecurity = { cookieAuth: [], ...(mutation ? { csrfToken: [] } : {}) };
    const security =
      access === 'public'
        ? []
        : access === 'agent'
          ? [{ agentBearer: [] }]
          : access === 'cookie'
            ? [cookieSecurity]
            : [cookieSecurity, { agentBearer: [] }];
    const responses: Operation['responses'] = {
      [mutation ? '201' : '200']: {
        description: definition.response
          ? 'Resultado con envelope ACC'
          : 'Documento OpenAPI sin envelope ACC',
        content: content(
          definition.response
            ? ref(definition.response)
            : { type: 'object', required: ['openapi', 'info', 'paths'] },
        ),
      },
      default: {
        description:
          'Error ACC: 400 validación/JSON/cursor; 401 auth; 403 permisos/Origin/CSRF; 404 inexistente; 409 conflicto/lease/cursor; 413 tamaño; 415 JSON requerido; 422 gates; 429 límite; 500 interno; 503 no disponible. Los detalles no incluyen secretos.',
        content: content(ref('Error')),
      },
    };
    let body: Operation['requestBody'];
    if (definition.body) {
      const name = definition.operationId + 'Input';
      schemas[name] = { ...schemaFor(definition.body), description: runtimeRules };
      if (['createOwnAgent', 'createAdminAgent'].includes(definition.operationId))
        schemas[name]!.oneOf = [
          { required: ['projectId'], not: { required: ['projectIds'] } },
          { required: ['projectIds'], not: { required: ['projectId'] } },
        ];
      if (['transitionTask', 'addEvidence'].includes(definition.operationId))
        schemas[name]!.dependentRequired = {
          sessionId: ['fencingToken'],
          fencingToken: ['sessionId'],
        };
      body = { required: true, content: content(ref(name)) };
    }
    paths[path] ??= {};
    paths[path][definition.method] = {
      operationId: definition.operationId,
      summary: definition.summary,
      tags: [definition.tag],
      description: [
        definition.description,
        definition.tag === 'Administración'
          ? 'Requiere usuario ADMIN del sistema.'
          : definition.tag === 'Agentes'
            ? 'Usuario gestiona sus agentes; ADMIN puede gestionar todos. No supera permisos vigentes del propietario.'
            : '',
        access === 'either'
          ? `Bearer requiere audiencia API y ${mutation ? 'task:write' : 'task:read'}; cookie requiere permisos vigentes.`
          : '',
        mutation && !definition.idempotent
          ? 'Esta operación no ofrece replay idempotente mediante Idempotency-Key.'
          : '',
        definition.body ? runtimeRules : '',
      ]
        .filter(Boolean)
        .join(' '),
      security,
      parameters,
      ...(body ? { requestBody: body } : {}),
      responses,
    };
  }
  return {
    openapi: '3.1.1',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'ACC REST API',
      version: '1.0.0',
      description:
        'Contrato de las rutas REST implementadas. No describe entidades pendientes. MCP /mcp y Socket.IO /ws/v1 tienen protocolos separados. POST devuelve 201 según NestJS. Scopes, claims, versiones y validación humana posterior a DONE siguen en servidor.',
    },
    servers: [{ url: '/' }],
    paths,
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'acc.sid',
          description: 'Cookie HttpOnly de ACC. Para login se obtiene primero una sesión anónima.',
        },
        csrfToken: {
          type: 'apiKey',
          in: 'header',
          name: 'x-csrf-token',
          description:
            'csrfToken devuelto por auth/session o auth/me; obligatorio para POST con cookie y Origin exacto.',
        },
        agentBearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'ACC opaque token',
          description:
            'Credencial con audiencia API (solo MCP no sirve para REST); task:read/task:write y permisos del propietario vigentes.',
        },
      },
      schemas,
    },
  };
}
