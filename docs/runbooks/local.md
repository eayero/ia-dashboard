# Entorno local

Solo desarrollo. Los puertos publicados se limitan a loopback. Compose incluye
PostgreSQL, Redis, migraciónes, bootstrap, API, worker y UI; usa autenticación
propia de ACC. Keycloak ya no es una dependencia del entorno actual.

## Arranque completo con Docker

Desde la raíz del repositorio:

1. Instalar pnpm compatible con `packageManager` del package.json.
   Si no existe en PATH, esta instalación local está en
   `.tools/node_modules/pnpm/pnpm.exe`. En PowerShell:
   `$env:Path=(Join-Path $PWD '.tools/node_modules/pnpm')+';'+$env:Path`.
2. `pnpm install --frozen-lockfile`.
3. Solo en una instalación nueva: `pnpm local:configure`. Genera `.env` y
   `.cache/local-login.txt`, ignorados por Git. Rechaza sobrescribir un `.env`
   existente. Conservar los archivos locales al retomar una instalación.
4. `docker compose --env-file .env -f infra/docker-compose.yml config --quiet`.
5. `docker compose --env-file .env -f infra/docker-compose.yml build api ui`.
6. `docker compose --env-file .env -f infra/docker-compose.yml up -d`.
7. `docker compose --env-file .env -f infra/docker-compose.yml ps --all`.
   API/UI/PG/Redis deben quedar saludables, worker activo y migrate/bootstrap con
   salida 0. Abrir **http://localhost:55173** y usar el login local.

La imagen usa Node 24 Alpine y Nginx; el primer build necesita acceso a los
registros y repositorios de paquetes. La API interna escucha en 0.0.0.0:53000
dentro del contenedor. En el host solo se publica en 127.0.0.1. Nginx sirve la UI
y hace proxy de API/MCP y WebSocket; el servidor WS y reconexión están implementados.

Migraciones y bootstrap se ejecutan antes de la API. PostgreSQL y Redis tienen
volúmenes persistentes. Bootstrap monta `.cache` para conservar las credenciales;
estos archivos no se incluyen en las imágenes. No editar migraciónes aplicadas:
el migrador comprueba sus checksums y aplica las nuevas en una transacción.

El bootstrap conserva IDs, contraseñas cambiadas, permisos, cuentas deshabilitadas,
credenciales expiradas y revocaciones existentes. No recupera secretos perdidos ni
renueva credenciales implícitamente: usar administración de ACC. La contraseña
inicial guardada puede dejar de ser válida después de cambiarla en la aplicación.

## Reinicio y comprobación

```powershell
docker compose --env-file .env -f infra/docker-compose.yml run --rm --no-deps bootstrap
docker compose --env-file .env -f infra/docker-compose.yml restart postgres redis api worker ui
docker compose --env-file .env -f infra/docker-compose.yml ps --all
pnpm mcp:smoke
```

Esperar a que los servicios estén saludables antes del smoke. El bootstrap de
contenedor solo permite el host PostgreSQL interno con
`ACC_LOCAL_DOCKER_BOOTSTRAP=1`, desarrollo y origen público loopback.

El reinicio y la repetición del bootstrap se comprobaron conservando 16 tareas,
identidades, permisos, credenciales y auditoría; ver
[resultado de Compose](../COMPOSE_VERIFICATION.json). Las restricciones se prueban
también en `tests/integration/bootstrap.test.ts`, sobre un esquema aislado.

`down` conserva volúmenes. No usar `down -v` para resolver fallos sin autorizar
la pérdida de datos. Un contenedor antiguo de Keycloak puede permanecer detenido;
no es necesario borrarlo. No imprimir `docker compose config` sin `--quiet`,
porque expande secretos.

## Desarrollo nativo

Para ejecutar API/UI/worker fuera de Docker, detener primero sus instancias
de Compose y mantener PostgreSQL/Redis activos:

```powershell
docker compose --env-file .env -f infra/docker-compose.yml stop ui api worker
pnpm db:migrate
pnpm local:bootstrap
pnpm --filter @acc/api dev
```

En otras terminales: `pnpm outbox:dev` y `pnpm dev:web`. No arrancar instancias
duplicadas sobre los mismos puertos. La configuración local usa hosts loopback;
Compose sustituye las conexiones internas sin modificar `.env`.

Puertos: PostgreSQL 55432, Redis 56379, API 53000, UI 55173.
El navegador debe usar el origen exacto de `PUBLIC_ORIGIN`.
Ver [API](api.md), [MCP](mcp.md), [web](web.md) y [eventos](events.md).

## Verificación del código

```powershell
pnpm test
pnpm test:integration
pnpm typecheck
pnpm typecheck:foundation
pnpm build
pnpm lint
pnpm format:check
```

Las integraciones usan esquemas PostgreSQL aleatorios `acc_test_*` y los eliminan
al finalizar; no modifican el esquema habitual ni borran volúmenes. Solo ejecutarlas
contra la BD local. Las pruebas HTTP usan puertos efímeros sin detener UI/preview
ni la API habitual en 53000.

La migración 005 añade usuarios locales, credenciales de agentes, límites de login
y auditoría de identidad; las tablas OIDC históricas conservan sus referencias.
La coordinación sigue validando identidad, membresía, versión, claim y gates
dentro de transacciones. Redis recibe eventos después del commit mediante outbox.
Requisitos versionados, su UI y servidor WS están implementados; preguntas y
decisiones siguen pendientes.

Instancia local actualizada: UI de requisitos, tiempo explícito y requisitos
obligatorios desplegados con migración 010 y 22 herramientas MCP.
Ver [despliegue](../requirements/TASK_REQUIREMENT_DEPLOYMENT.json).
El catálogo REST de repositorios está verificado en código con migración 011,
desplegado desde 8cb9417 con migración 011. Ver docs/requirements/REPOSITORY_REGISTRY_DEPLOYMENT.json. La API exige 011 al arrancar; conservar
001–010 y actualizar API/worker/UI juntos por el nuevo tipo de evento REPOSITORY.
No ejecutar migración/despliegue por leer esta guía.
