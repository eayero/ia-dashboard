# Entorno local

Solo desarrollo. Servicios limitados a loopback; Keycloak start-dev y sus datos
embebidos no constituyen un despliegue de producción. No activar servicios reales.

1. Instalar pnpm compatible con `packageManager` del package.json.
   En esta sesión está instalado localmente en `.tools/node_modules/pnpm/pnpm.exe`.
   Si no existe `pnpm` en PATH, en PowerShell ejecutar
   `$env:Path=(Join-Path $PWD '.tools/node_modules/pnpm')+';'+$env:Path`
   desde la raíz. No cambia la configuración global. Los scripts que invocan
   pnpm necesitan ese PATH, aunque se lance el binario mediante su ruta completa.
2. `pnpm install --frozen-lockfile` (primera generación del lockfile: `pnpm install`).
3. `pnpm local:configure`: genera `.env`, realm Keycloak y login sintético en
   `.cache/local-login.txt`, todos ignorados por Git. No sobrescribe un `.env` existente.
4. `docker compose --env-file .env -f infra/docker-compose.yml up -d`.
5. `pnpm db:migrate` aplica migraciones SQL pendientes en una transacción y comprueba
   el checksum de las ya aplicadas. No editar una migración aplicada: añadir otra.
6. `pnpm local:bootstrap` preaprovisiona el owner y dos service accounts locales,
   conserva permisos existentes y escribe credenciales ignoradas en `.cache/local-agents.json`.
7. `pnpm --filter @acc/api dev` arranca la API en 53000. [Guía de API](api.md).
   En otra terminal, `pnpm outbox:dev` inicia el [publicador de eventos](events.md).
   `pnpm dev:web` sirve el [dashboard](web.md) en http://localhost:55173.
8. `pnpm test`, `pnpm typecheck:foundation`, `pnpm build:foundation` y
   `pnpm test:integration` verifican dominio, contratos y coordinación PostgreSQL.
   Las pruebas de integración crean y eliminan un esquema aleatorio `acc_test_*`;
   no modifican tablas del esquema habitual ni borran volúmenes. Solo usar una BD local.

La API incluye el [gateway MCP autenticado](mcp.md), comprobable con `pnpm mcp:smoke`.
`pnpm build` y `pnpm typecheck` verifican los cinco paquetes existentes; también hay
comandos `*:api`, `*:web` y `*:foundation`. Detener web/preview antes de ejecutar
integraciones: sus pruebas HTTP usan 55173. La API habitual puede continuar en 53000.

La capa de coordinación recibe `principalId` de la autenticación verificada en REST/MCP.
La migración 003 añade identidades OIDC, sesiones BFF, autorización activa de proyecto,
versiones de sesiones ACC y auditoría tipada para tareas/sesiones/principales. La migración 002
añade dependencias, repositorios, evidencias, aprobaciones y alertas de tareas.
Preguntas, requisitos, decisiones y el resto de entidades siguen pendientes.
La migración 004 añade snapshots paginados temporales y leases/reintentos del outbox.
El worker Redis corre separado; una caída del transporte no revierte mutaciones.

El recorrido interno real hasta DONE está en `tests/integration/workflow.test.ts`.
`CoordinationStore` reutiliza la máquina de estados del dominio y deriva los gates
de la BD. El cliente no declara criterios verificados ni aprobaciones.
`updateWork` incrementa `work_revision`; heartbeat, evidencia y aprobación cambian
solo `version`. Cada comando de mutación conserva idempotencia, evento y outbox.
Revisión, QA y cierre son aprobaciones humanas separadas de la revisión vigente.

Un cambio humano de título/criterios/tipo mediante `reviseTask` vuelve a BACKLOG.
Cambiar dependencias durante ejecución/review/QA revoca propiedad y aprobaciones:
si falta una dependencia queda BLOCKED; si están satisfechas vuelve a READY.
Ambos casos exigen adquirir otro claim antes de continuar. Un bloqueo manual solo
se resuelve mediante transición explícita, aunque se satisfagan las dependencias.
CODE requiere evidencia CODE y TEST PASS aceptadas del mismo repositorio/commit;
los TEST incluyen `{outcome,total,passed}` y nunca se descargan URLs del servidor.
La aceptación humana no equivale a una verificación automática de CI.

Puertos reservados: PostgreSQL 55432, Redis 56379, Keycloak 58080, API 53000,
Vite 55173. El navegador usa localhost:55173; desarrollo y preview hacen proxy de
/api, /ws, /mcp y /.well-known/oauth-protected-resource/mcp. El servidor WS sigue pendiente.

No ejecutar `docker compose config` en un log compartido: puede expandir secretos.
Usar `config --quiet` para validar. `down` conserva volúmenes; no usar `down -v`
para resolver fallos sin autorizar antes la pérdida de datos.

La primera carga del realm fija el secreto OIDC. No regenerarlo manteniendo un
realm antiguo. La aplicación debe fallar con error explícito si la configuración
OIDC no corresponde al realm, nunca desactivar autenticación como alternativa.
