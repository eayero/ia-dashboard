# Punto de continuación — desarrollo reanudado

Reanudado por el usuario. Estado actual en [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
Las notas siguientes conservan el contexto de la pausa y sus comprobaciones históricas.

Fecha: 2026-11-03. El usuario pidió: «pausa el proceso de desarrollo deja las notas
para continar». Desarrollo detenido; no continuar hasta que lo solicite.

Rama: `feat/acc-foundation`. Último commit publicado:
`2baf059e97673537160a7f58cd160e17ae324c50` (dashboard con autenticación anterior).
La migración de autenticación y Docker de este hito está **sin commit ni push**,
con cambios modificados y archivos nuevos sin seguimiento. Conservar todo.

## Alcance aprobado que debe conservarse

1. Sustituir Keycloak por autenticación propia de ACC, porque los usuarios solo
   pertenecen a esta aplicación. Mantener sesiones HttpOnly, CSRF, permisos por
   proyecto, historial e IDs existentes. Usuarios sin registro público.
2. Usuarios/proyectos/roles administrados desde ACC; recuperación mediante
   contraseña temporal emitida por administrador y cambio obligatorio al entrar.
3. Agentes con secretos propios, revocables, caducidad, scopes y canales API/MCP.
4. Última ampliación expresa: «Incluye en el docker compose levantar le backend y
   la UI». Compose debe levantar toda la aplicación, no solo PG/Redis.

Estas decisiones sustituyen los puntos OIDC/Keycloak de Q8/Q36 y de la especificación.
Las guías operativas y la especificación aún contienen texto anterior: actualizarlas
antes de declarar terminada la migración. No hay merge ni despliegue externo pedidos.

## Implementación local realizada

- `packages/db/migrations/005_local_auth.sql`: local_users, agent_credentials,
  login_throttles, security_events append-only y auditoría de acciones globales
  de identidad. **Aplicada al PostgreSQL local habitual**; no editar su contenido
  en adelante: usar otra migración si hace falta cambiar el esquema.
- `apps/api/src/auth/service.ts`: login con username/password, CSRF previo,
  rotación del SID, sesión absoluta de una hora, verificación de versión de
  credenciales y bloqueo de cuentas deshabilitadas. Cambiar/restablecer contraseña
  invalida cookies anteriores; OIDC/JWT/cookies antiguos ya no autentican.
- `auth/password.ts`: scrypt de Node, N=131072/r=8/p=1, sal aleatoria de 16 bytes,
  hash de 64 bytes, comparación segura y máximo de cuatro derivaciones simultáneas.
  Nuevas contraseñas: 15–128 caracteres. Login genérico para cuenta desconocida,
  contraseña incorrecta o cuenta deshabilitada. Límite PG de 10 intentos/cuenta y
  50/IP por quince minutos; limpieza acotada de registros antiguos.
- `auth/admin.ts` y `admin-controller.ts`: crear/listar usuarios con sus proyectos,
  deshabilitar/habilitar, restablecer contraseña, asignar roles/acceso por proyecto,
  emitir/listar/revocar credenciales de agentes. Administración exige humano ADMIN
  del sistema vigente. Cambios de membresía usan versión optimista (0 para alta).
- Deshabilitar o retirar acceso termina sesiones ACC/invalida claims. Revocar una
  credencial también termina sesiones de su principal e invalida claims. No se
  pueden retirar los últimos propietarios activos ni deshabilitarse uno mismo.
- Administrador del sistema puede gestionar identidades/asignaciones globalmente;
  no obtiene lectura/mutación de tareas sin membresía. Auditoría permite actores
  ADMIN fuera del proyecto solo para acciones de identidad enumeradas en SQL.
- `auth/credentials.ts`: tokens opacos `acc_<uuid>.<secreto aleatorio>`, solo SHA-256
  en DB, secreto devuelto al emitir, scopes y audiencias api/mcp, 1–30 días.
- Se retiraron servicio/fixtures de Keycloak y dependencias directas jose/openid-client;
  lockfile actualizado e instalación frozen completada. La tabla oidc_identities
  conserva referencias históricas y sirve para identificar al owner al migrar.
- Bootstrap reescrito: preserva owner/IDs, contraseña, permisos y revocaciones;
  usa los archivos ignorados existentes. `.cache/local-agents.json` ahora tiene
  `projectId` y agentes con `label`, `principalId`, `apiToken`, `mcpToken`.
  No renueva ni recupera implícitamente secretos de credenciales existentes.
- Frontend: `auth-forms.tsx` login/cambio de contraseña; `accounts.tsx` usuarios,
  asignaciones, recuperación y credenciales. App incorpora «Usuarios y accesos»
  para administradores y «Mi contraseña». Acceso temporal obliga a cambiarla.
  Cambiar contraseña incorrecta devuelve 400, sin cerrar una sesión válida.
- Caché de sesión: además de consultas, limpia mutaciones al salir/expirar.
  Secretos emitidos solo se mantienen en memoria; nunca storage persistente.
- MCP conserva quince herramientas y cliente oficial; ahora usa tokens opacos
  preconfigurados. Metadata ya no anuncia Keycloak ni scope acc:mcp. No se ha
  implementado un servidor OAuth propio; documentar este cambio con precisión.

## Docker preparado, todavía sin validación de arranque completo

Archivos: `.dockerignore`, `infra/Dockerfile`, `infra/nginx.conf` y Compose ampliado.

- Servicios: postgres, redis, migrate, bootstrap, api, worker y ui.
- Migraciones y bootstrap son tareas de una ejecución, con dependencias de éxito.
- API y worker usan imagen `acc-api:local`; UI `acc-ui:local` con Nginx.
- Backend interno escucha 0.0.0.0:53000 mediante API_HOST; puerto host solo loopback.
  UI publica loopback 55173 hacia 8080 y proxy de API/MCP/discovery/reserva WS.
- Bootstrap de contenedor acepta host postgres solo con
  `ACC_LOCAL_DOCKER_BOOTSTRAP=1`, development y origen público loopback.
- Credenciales de desarrollo montadas desde `.cache`, sin copiarlas a imágenes.
  PostgreSQL/Redis conservan sus volúmenes. API ejecuta como usuario node.
- `docker compose --env-file .env -f infra/docker-compose.yml config --quiet` pasó.
- Keycloak fue **detenido** con Compose anterior, sin borrar contenedor/volúmenes.
  Ya no figura en Compose. Variables antiguas pueden seguir en `.env` privado:
  no son usadas por la nueva API; no imprimir ni versionar esos valores.

Bloqueo observado: varios timeouts TLS al consultar Docker Hub. Se reintentó fuera
del sandbox; no fue solo un permiso local. Docker server informa 20.10.17 y proxy
configurado. No se modificó configuración global de Docker.

- `node:24-alpine` se descargó completamente. Digest observado:
  `sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85`.
- Nginx Docker Hub falló en handshake. Se inició una alternativa oficial publicada
  por Docker en ECR Public: `public.ecr.aws/docker/library/nginx:1.30.6-alpine`.
  Se descargaron varias capas, pero la descarga se interrumpió al pedir pausa.
- El build de API avanzó a instalaciones de openssl/pnpm, pero fue interrumpido.
  **No hay build final de API/UI ni `compose up` completo confirmados.**
- Dockerfile aún referencia `nginx:1.30.6-alpine` en Docker Hub. Si se usa el espejo,
  hacerlo explícito con argumentos de build o configuración documentada; no alterar
  credenciales/proxy globales. Referencia del espejo oficial:
  https://gallery.ecr.aws/docker/library/nginx

## Verificación obtenida antes de la pausa

- **52 pruebas unitarias** pasaron (incluye scrypt).
- **73 integraciones reales** pasaron con PG/Redis y Keycloak detenido: REST,
  administración/login local, scopes, MCP, auditoría, claims y workflow.
- Build/tipos globales de cinco paquetes y tipos de integraciones pasaron.
- Lint pasó en una validación previa; falta repetirlo tras el último ajuste menor
  y hacer la comprobación final de formato/diff.
- Se reprodujo antes de corregir que deshabilitar al último OWNER era permitido;
  ahora lo rechaza. Se probó rollback del reset si falla la auditoría.
- `pnpm install --frozen-lockfile` completó; no aprobar skills de dependencias
  por aparecer en el mensaje de pnpm (siguen pendientes de autorización).
- **La UI nueva de login y administración aún no se ha comprobado en navegador.**
  No confundir las revisiones del dashboard anterior con esta interfaz nueva.

## Procesos al detener el desarrollo

Se interrumpieron con Ctrl+C las sesiones propias:

- Build Docker API: sesión de herramienta 5287.
- Pull Nginx ECR: sesión 49642.

Quedaron iniciados para uso local (comprobar que sigan activos al retomar):

- API compilada nativa, sesión 11513, 127.0.0.1:53000, autenticación propia.
- UI preview compilada, sesión 80620, http://localhost:55173.
- Worker nativo anterior, sesión 1058; compatible con las tablas de outbox actuales.
- PostgreSQL/Redis locales. Keycloak detenido.

No matar procesos ajenos para liberar puertos. Las integraciones HTTP necesitan
55173 libre: detener primero la UI propia. Antes de `compose up`, detener API/UI/
worker nativos propios para evitar puertos ocupados y workers duplicados.

## Orden sugerido al reanudar

1. Leer README, COMO-TRABAJAMOS y esta nota; revisar Git y procesos/servicios.
2. Revisar seguridad y casos de borde pendientes. En particular, impedir que un
   usuario marque completado el cambio obligatorio reutilizando la misma contraseña
   temporal: actualmente no hay comprobación de igualdad entre actual/nueva.
3. Probar UI real: login, primer cambio, usuarios/proyectos, permisos de consulta,
   reset/deshabilitación, secreto de agente mostrado una sola vez y revocación;
   escritorio/móvil y expiración/logout. No imprimir secretos ni capturar el modal
   de credenciales en artefactos compartidos.
4. Terminar descargas/build Docker y validar Compose real: migrate/bootstrap/API,
   UI/proxy, worker, healthchecks, reinicio con volúmenes y bootstrap idempotente.
   Verificar permisos del montaje `.cache` para el usuario node y CSP de Nginx.
   Revisar fallback: assets inexistentes deben devolver 404, no index.html.
5. Actualizar ADR, decisiones/especificación y runbooks de auth/MCP/Docker/web;
   los textos anteriores todavía dicen OIDC/Keycloak y son parcialmente obsoletos.
6. Cerrar verificación pertinente, revisar secretos/diff y entonces registrar el
   resultado/publicación dentro del alcance autorizado. No publicar como terminada
   esta migración antes de esas comprobaciones.

Comandos útiles desde D:\Dashboard (PowerShell):

```powershell
$env:Path=(Join-Path $PWD '.tools/node_modules/pnpm')+';'+$env:Path
pnpm test
pnpm test:integration
pnpm build
pnpm typecheck
pnpm typecheck:foundation
pnpm lint
pnpm format:check
docker compose --env-file .env -f infra/docker-compose.yml build api ui
docker compose --env-file .env -f infra/docker-compose.yml up -d
```

No ejecutar `docker compose config` sin `--quiet` en logs compartidos (expande
secretos). No usar down -v. No editar migraciones aplicadas. Antiguos helpers
ignorados `.cache/login-web.mjs`, `.cache/mcp-proxy-smoke.mjs` y
`.cache/claude-mcp-check.mjs` aún contienen flujos OIDC: adaptar antes de usarlos.
El smoke versionado `pnpm mcp:smoke` sí fue adaptado a mcpToken, pero falta ejecutarlo
contra el runtime nuevo. Credenciales solo en `.cache`; no copiarlas a estas notas.
