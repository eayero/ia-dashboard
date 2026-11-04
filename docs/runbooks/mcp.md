# Gateway MCP local

`/mcp` ofrece Streamable HTTP autenticado dentro del proceso NestJS. Reutiliza
los contratos, lecturas y comandos transaccionales de REST, sin llamadas HTTP
internas ni reenvío de tokens. Se aloja en la API para compartir autorización y
ciclo de vida; todavía no existe un proceso independiente `apps/mcp`.

SDK oficial fijado: `@modelcontextprotocol/sdk@1.32.2`. El SDK negocia las
versiones que soporta; el cliente oficial probó `2025-11-25`. No se anuncia
compatibilidad con versiones futuras por aparecer en la especificación del proyecto.
Referencias: [SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x),
[transporte](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
y [autorización](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

## Autenticación y transporte

- Bearer opaco de ACC, identidad AGENT, vigencia y revocación validadas en cada
  petición. Una cookie humana no autentica MCP. Solo se guarda el hash del token.
- La credencial debe incluir audiencia `mcp`; una con solo `api` se rechaza.
  El recurso público es `${PUBLIC_ORIGIN}/mcp`. El gateway no reenvía tokens.
- `task:read` es necesario para conectar y leer; las mutaciones también exigen
  `task:write`. Los scopes de la credencial y los permisos activos en PostgreSQL se comprueban
  por separado. La revocación impide la siguiente llamada, incluidos reintentos.
- Discovery: `/.well-known/oauth-protected-resource/mcp`, con recurso, método
  Bearer por header y scopes; no anuncia issuer ni authorization_servers. El challenge 401 lo referencia. Scopes insuficientes devuelven HTTP 403
  y `WWW-Authenticate: Bearer error="insufficient_scope"` con scopes requeridos.
- Origin ausente se admite para clientes nativos; si está presente debe coincidir
  exactamente con `PUBLIC_ORIGIN`. Host no determina audiencia ni metadata.
- Transporte sin estado y respuestas JSON. No crea IDs de sesión MCP ni sesiones
  ACC implícitas. GET/DELETE autenticados devuelven 405; no hay SSE persistente.
  Las sesiones ACC se crean y renuevan con herramientas explícitas.
- Comparte límite JSON de 32 KiB, rate limit, no-store y errores seguros de la API.
  Datos, errores de validación, conflictos y gates de las herramientas usan
  `structuredContent` y contenido textual JSON equivalente; errores tienen
  `isError:true`, código estable y requestId. Los errores de autenticación y scopes son HTTP.

El bootstrap local genera credenciales separadas API/MCP para dos agentes y las
conserva en `.cache/local-agents.json`. El campo `mcpToken` se envía como
`Authorization: Bearer <token>` por un cliente configurado manualmente. La UI de
administración permite emitir credenciales con scopes, audiencias y caducidad.
El secreto se muestra una sola vez; las revocadas no se renuevan por bootstrap.

No hay servidor OAuth propio, grant client_credentials, registro dinámico ni
login OAuth interactivo MCP. La metadata del recurso no acredita un flujo OAuth
completo. El login humano por usuario/contraseña es independiente.

## Herramientas disponibles

| Herramienta              | Función                                                   |
| ------------------------ | --------------------------------------------------------- |
| acc_list_projects        | Proyectos accesibles al agente                            |
| acc_get_context          | Snapshot consistente paginado                             |
| acc_get_changes          | Delta con secuencia y cursores                            |
| acc_list_tasks           | Listado paginado de tareas                                |
| acc_get_task             | Detalle, versión, evidencias, aprobaciones y claim propio |
| acc_find_or_create_task  | Identidad externa exacta o creación BACKLOG               |
| acc_register_session     | Registrar sesión ACC explícita                            |
| acc_heartbeat_session    | Renovar sesión; no renueva claims                         |
| acc_end_session          | Terminar sesión e invalidar claims                        |
| acc_claim_task           | Adquirir propiedad con versión y sesión vigentes          |
| acc_heartbeat_task       | Renovar claim con fencing y versión                       |
| acc_release_task         | Liberar claim propio                                      |
| acc_update_task          | Actualizar resumen de implementación bajo claim           |
| acc_transition_task      | Solicitar transición respetando gates y permisos          |
| acc_add_evidence         | Adjuntar evidencia; no constituye aceptación humana       |
| acc_register_requirement | Proponer requisito o recuperar externalRef exacta         |
| acc_revise_requirement   | Nueva propuesta sin sustituir la revisión aprobada        |
| acc_list_requirements    | Requisitos paginados por proyecto                         |
| acc_get_requirement      | Historial, aprobación, vínculos e impacto                 |

Todos los inputs son objetos estrictos. Las herramientas de proyecto reciben
`projectId`; lecturas paginadas reciben `query`, aunque sea `{}`. Mutaciones
reciben `idempotencyKey` e `input`; comandos de tarea añaden `taskId`, y comandos
de sesión `sessionId`. La identidad proviene del token, nunca de argumentos.
Consultar los JSON Schema mediante `tools/list`, sin inventar campos.

No hay proyecto activo global ni selección automática por carpeta. Primero
`acc_list_projects({})` devuelve los proyectos accesibles; el cliente elige el ID
y lo incluye en cada llamada. En este repositorio el espejo usa
`3268b4d2-cd9d-4afc-bc76-ea631997cd73`, «ACC · Demostración local». El token
identifica al agente; no sustituye la membresía del proyecto.

Cada agente tiene un usuario propietario. La misma credencial/configuración MCP
puede listar y usar todos sus proyectos asignados, indicando projectId en cada
llamada; no es necesario crear otra identidad para otro proyecto o credencial.
El servidor comprueba token, membresía del agente y acceso vigente del propietario.
Retirar acceso o deshabilitar a esa persona corta la vía del agente. Contexto
incluye agentName/ownerUserId/ownerUsername en MEMBER; los eventos nuevos guardan
actorId agente y actorUserId propietario. Estos campos no los elige el cliente.

Buscar antes de crear. `externalRef` encuentra una identidad exacta; un título
similar no fusiona tareas automáticamente. Repetir un comando con la misma clave
y contenido conserva el resultado; cambiar el contenido produce conflicto.
Las aprobaciones humanas y el cambio de alcance permanecen en los canales humanos.
El agente con task:write puede mover a READY, QA y DONE, cancelar y reabrir dentro
del grafo válido. Evidencias técnicas declaradas y criterios, dependencias,
versiones y claims siguen siendo obligatorios. La validación humana posterior a
DONE es independiente, no cambia estado y se realiza por el canal humano REST/UI.

Secuencia recomendada: listar proyectos → registrar sesión → cargar todas las
páginas de contexto → buscar/crear tarea → adquirir claim → implementar/renovar →
adjuntar evidencia → solicitar revisión mediante transición → liberar o terminar
sesión. Al retomar, consultar delta y reconciliar detalles; un cursor inválido o
expirado requiere snapshot nuevo. [Semántica de contexto y eventos](events.md).

Hay 19 herramientas en el código actual. Las cuatro de requisitos se probaron con
el SDK oficial en instancias aisladas; el servidor local anterior no se reinició.
[Contrato y uso](../requirements/VERSIONED_REQUIREMENTS_API.md).
Herramientas de decisiones y preguntas, `acc_request_approval` separado,
skill portable y adaptador ECC siguen pendientes. No se anuncian herramientas
que no tengan persistencia/comportamiento implementados.

## Ejecutar y comprobar

Preparar el [entorno local](local.md), migrar y ejecutar `pnpm local:bootstrap`.
Arrancar la API con `pnpm --filter @acc/api dev`, o compilar y ejecutar
`node --env-file=.env apps/api/dist/main.js`.

```powershell
pnpm mcp:smoke
```

El smoke lee `mcpToken` de las credenciales ignoradas de `.cache/local-agents.json`
y comprueba herramientas/contexto/delta con el cliente oficial.
No imprime tokens ni crea tareas/sesiones ACC. Se puede probar el artefacto compilado:
`node --env-file=.env apps/api/dist/mcp/smoke.js` tras `pnpm build:api`.

Conecta directamente a loopback 53000. La audiencia y discovery siguen referidos
al origen público configurado (localmente 55173). El [dashboard](web.md) expone
`/mcp` y `/.well-known/oauth-protected-resource/mcp` mediante su proxy local.
Se probaron discovery, inicialización, quince herramientas y contexto del cliente
oficial a través de ese origen público en preview compilado.

`tests/integration/mcp.test.ts` usa el cliente oficial, PostgreSQL real y autenticación propia:
contratos, contexto/delta, reintentos, dos agentes/claims, fencing, evidencia,
flujo autónomo hasta DONE y revocación. Las pruebas REST acreditan por separado
login local, cookies, CSRF y validación exclusivamente humana posterior a DONE.
`local-auth.test.ts` comprueba con el cliente MCP oficial una misma credencial
en dos proyectos, identidad del propietario y restricciones de acceso vigentes.
Ver [resultado de propiedad y proyectos](../AGENT_OWNERSHIP_RESULT.json).

Comprobación adicional: Claude Code **2.1.317**, `mcp list`, confirmó **Connected**
contra la API compilada. Se usó `CLAUDE_CONFIG_DIR` dentro de `.cache` y un header
que expande una variable de entorno; no se cambiaron ajustes globales del usuario.
Eso acredita conexión/health, no ejecución de tareas ni login interactivo de Claude.
La conexión de Claude corresponde al hito anterior con autenticación OIDC; debe
revalidarse tras la migración de autenticación. Codex ya ejecutó seis herramientas
nativas con tokens propios de ACC: verificó 15 referencias, reintentos sin
duplicados, contexto y delta. Ver [evidencia de Codex](../CODEX_MCP_RESULT.json).
El recorrido autónomo se comprobó después por MCP nativo de Codex; ver
[resultado del flujo](../AGENT_WORKFLOW_RESULT.json). La nueva conexión de Claude
continúa pendiente de revalidación.
