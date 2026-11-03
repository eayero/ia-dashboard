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

- Bearer RS256 de Keycloak, identidad AGENT preaprovisionada, issuer y expiración
  validados en cada petición. Una cookie BFF humana no autentica MCP.
- Audiencia requerida: `${PUBLIC_ORIGIN}/mcp`. Un token solo para `acc-api` se
  rechaza, aunque funcione en REST. El gateway nunca lo reenvía a otro servicio.
- `task:read` es necesario para conectar y leer; las mutaciones también exigen
  `task:write`. Los scopes OAuth y los permisos activos en PostgreSQL se comprueban
  por separado. La revocación impide la siguiente llamada, incluidos reintentos.
- Discovery: `/.well-known/oauth-protected-resource/mcp`, con recurso, issuer y
  scopes. El challenge 401 lo referencia. Scopes insuficientes devuelven HTTP 403
  y `WWW-Authenticate: Bearer error="insufficient_scope"` con scopes requeridos.
- Origin ausente se admite para clientes nativos; si está presente debe coincidir
  exactamente con `PUBLIC_ORIGIN`. Host no determina audiencia ni metadata.
- Transporte sin estado y respuestas JSON. No crea IDs de sesión MCP ni sesiones
  ACC implícitas. GET/DELETE autenticados devuelven 405; no hay SSE persistente.
  Las sesiones ACC se crean y renuevan con herramientas explícitas.
- Comparte límite JSON de 32 KiB, rate limit, no-store y errores seguros de la API.
  Datos, errores de validación, conflictos y gates de las herramientas usan
  `structuredContent` y contenido textual JSON equivalente; errores tienen
  `isError:true`, código estable y requestId. Los errores OAuth son HTTP.

El bootstrap local añade el client scope opcional `acc:mcp` a los dos service
accounts marcados, con mapper de audiencia del recurso. Solicitarlo mediante
`scope=acc:mcp` y enviar `resource=${PUBLIC_ORIGIN}/mcp` al obtener el token.
Los tokens REST ordinarios conservan solo su audiencia REST. En producción,
aprovisionar clientes/scopes/audiencias explícitamente con HTTPS; el bootstrap
está restringido a desarrollo local.

Este hito usa `client_credentials` preaprovisionado. No implementa registro
dinámico de clientes ni login OAuth interactivo de clientes MCP de escritorio.
El login humano BFF existente es un flujo separado.

## Herramientas disponibles

| Herramienta             | Función                                                   |
| ----------------------- | --------------------------------------------------------- |
| acc_list_projects       | Proyectos accesibles al agente                            |
| acc_get_context         | Snapshot consistente paginado                             |
| acc_get_changes         | Delta con secuencia y cursores                            |
| acc_list_tasks          | Listado paginado de tareas                                |
| acc_get_task            | Detalle, versión, evidencias, aprobaciones y claim propio |
| acc_find_or_create_task | Identidad externa exacta o creación BACKLOG               |
| acc_register_session    | Registrar sesión ACC explícita                            |
| acc_heartbeat_session   | Renovar sesión; no renueva claims                         |
| acc_end_session         | Terminar sesión e invalidar claims                        |
| acc_claim_task          | Adquirir propiedad con versión y sesión vigentes          |
| acc_heartbeat_task      | Renovar claim con fencing y versión                       |
| acc_release_task        | Liberar claim propio                                      |
| acc_update_task         | Actualizar resumen de implementación bajo claim           |
| acc_transition_task     | Solicitar transición respetando gates y permisos          |
| acc_add_evidence        | Adjuntar evidencia; no constituye aceptación humana       |

Todos los inputs son objetos estrictos. Las herramientas de proyecto reciben
`projectId`; lecturas paginadas reciben `query`, aunque sea `{}`. Mutaciones
reciben `idempotencyKey` e `input`; comandos de tarea añaden `taskId`, y comandos
de sesión `sessionId`. La identidad proviene del token, nunca de argumentos.
Consultar los JSON Schema mediante `tools/list`, sin inventar campos.

Buscar antes de crear. `externalRef` encuentra una identidad exacta; un título
similar no fusiona tareas automáticamente. Repetir un comando con la misma clave
y contenido conserva el resultado; cambiar el contenido produce conflicto.
Las aprobaciones humanas y el cambio de alcance permanecen en los canales humanos.
Un agente no puede mover a QA ni cerrar DONE, incluso con aprobaciones existentes.

Secuencia recomendada: listar proyectos → registrar sesión → cargar todas las
páginas de contexto → buscar/crear tarea → adquirir claim → implementar/renovar →
adjuntar evidencia → solicitar revisión mediante transición → liberar o terminar
sesión. Al retomar, consultar delta y reconciliar detalles; un cursor inválido o
expirado requiere snapshot nuevo. [Semántica de contexto y eventos](events.md).

Herramientas de requisitos, decisiones y preguntas, `acc_request_approval` separado,
skill portable y adaptador ECC siguen pendientes. No se anuncian herramientas
que no tengan persistencia/comportamiento implementados.

## Ejecutar y comprobar

Preparar el [entorno local](local.md), migrar y ejecutar `pnpm local:bootstrap`.
Arrancar la API con `pnpm --filter @acc/api dev`, o compilar y ejecutar
`node --env-file=.env apps/api/dist/main.js`.

```powershell
pnpm mcp:smoke
```

El smoke lee las credenciales ignoradas de `.cache/local-agents.json`, obtiene
un token en memoria y comprueba herramientas/contexto/delta con el cliente oficial.
No imprime tokens ni crea tareas/sesiones ACC. Se puede probar el artefacto compilado:
`node --env-file=.env apps/api/dist/mcp/smoke.js` tras `pnpm build:api`.

Conecta directamente a loopback 53000. La audiencia y discovery siguen referidos
al origen público configurado (localmente 55173). El [dashboard](web.md) expone
`/mcp` y `/.well-known/oauth-protected-resource/mcp` mediante su proxy local.
Se probaron discovery, inicialización, quince herramientas y contexto del cliente
oficial a través de ese origen público en preview compilado.

`tests/integration/mcp.test.ts` usa el cliente oficial, PostgreSQL y Keycloak reales:
contratos, contexto/delta, reintentos, dos agentes/claims, fencing, evidencia,
permisos humanos hasta DONE y revocación. Las acciones humanas del recorrido MCP
se ejecutan por el servicio transaccional, no mediante una identidad agente.
Las pruebas REST acreditan por separado el flujo humano OIDC/CSRF.

Comprobación adicional: Claude Code **2.1.317**, `mcp list`, confirmó **Connected**
contra la API compilada. Se usó `CLAUDE_CONFIG_DIR` dentro de `.cache` y un header
que expande una variable de entorno; no se cambiaron ajustes globales del usuario.
Eso acredita conexión/health, no ejecución de tareas ni login interactivo de Claude.
Codex CLI no se encontró en PATH: su smoke y los recorridos completos de ambos
clientes siguen pendientes. No declarar interoperabilidad total por el smoke del SDK.
