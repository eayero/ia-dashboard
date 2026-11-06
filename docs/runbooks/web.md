# Dashboard local

Instancia vigente: commit `55fdb94`, migraciones **012/013** y **34 herramientas MCP**, desplegados en http://localhost:55173. [Informe verificado](../requirements/SPRINT_GOVERNANCE_DEPLOYMENT.json). Las notas de versiones anteriores conservan su alcance histórico.

Antes de trabajar, elegir requisito principal cuando sea ambiguo y asignar el requisito a un sprint ACTIVE. La tarea hereda el sprint; el servidor impide claim/inicio/escritura productiva fuera de ejecución. Preguntas y decisiones ya están disponibles; solo humanos confirman respuestas y aprueban decisiones.

SPA React/Vite con TanStack Router y Query, en la dirección visual aprobada:
navegación verde oscuro, superficie clara, tabla de trabajo y bandeja de atención.
Los datos proceden de PostgreSQL a través de la API; no hay contadores sintéticos.

## Ejecutar

Con el [entorno local](local.md) preparado y la API en 53000:

```powershell
pnpm dev:web
```

Abrir **http://localhost:55173**, exactamente el origen de `.env`. El formulario
recibe usuario/contraseña locales; cookie HttpOnly/SameSite y CSRF se gestionan
por la API. Compose ya sirve esta UI con Nginx; no iniciar dev/preview sobre su
puerto ocupado. Ver [entorno local](local.md) para cambiar a desarrollo nativo.
La SPA no persiste tokens ni credenciales en localStorage/sessionStorage.

Para revisar el artefacto compilado localmente, detener primero `dev:web`:

```powershell
pnpm build:web
pnpm preview:web
```

Preview y desarrollo escuchan en loopback y exigen el puerto 55173 libre. Sus
proxies cubren `/api`, `/mcp`, `/.well-known/oauth-protected-resource/mcp` y `/ws`.
La ruta `/ws` está preparada en el proxy; el servidor WS aún no está implementado.
Preview es una comprobación local del build, no un despliegue de producción.

`pnpm build` y `pnpm typecheck` ya abarcan los cinco paquetes existentes.
`pnpm dev` arranca API y web; no usarlo si una API ya ocupa 53000. El worker outbox
sigue separado mediante `pnpm outbox:dev`.

## Comportamiento disponible

- «Mis agentes» para cada usuario: identidad propia, propietario, proyectos,
  credenciales API/MCP, emisión adicional y revocación. ADMIN ve todos los agentes
  en Usuarios y accesos y cada fila de usuario muestra los agentes que posee.
- Un agente puede tener varios proyectos y credenciales; la UI distingue ambos
  conceptos. Las sesiones reclamadas muestran nombre del agente y su propietario.

- Login local, cambio de contraseña y cambio obligatorio de contraseña temporal.
- «Usuarios y accesos» para ADMIN del sistema: usuarios, acceso/roles por proyecto,
  reset temporal, habilitación y credenciales de agentes con revocación. El rol
  global no concede lectura de proyectos sin membresía. Secretos emitidos solo en
  memoria, mostrados una vez; no incluirlos en capturas ni artefactos compartidos.

- Selección de proyectos autorizados, resumen con denominadores, búsqueda por
  título/ID, filtro de estado y bandeja de tareas bloqueadas/en revisión/en QA.
- Creación BACKLOG con criterios obligatorios y referencia externa opcional.
- Detalle con versiones, dependencias, implementación, evidencia y aprobaciones.
  El enlace conserva proyecto/tarea al recargar y en el historial del navegador.
- Sesiones ACC explícitas y finalización; reclamar, renovar/liberar, actualizar
  implementación y adjuntar informes OTHER/REVIEW. Iniciar sesión de trabajo
  desde «Sesiones» antes de reclamar una tarea.
- Paso por revisión/QA hasta DONE sin aprobaciones humanas previas. En DONE,
  «Validar tarea» registra un OK humano sin cambiar estado ni revisión. Se muestra
  quién validó, cuándo y el historial; reapertura deja el OK anterior como histórico.
- Permisos de interfaz derivados de la membresía del snapshot; servidor vuelve
  a validarlos en cada comando. VIEWER tiene detalle de consulta, sin mutaciones.
- Diálogos nativos, etiquetas, foco visible, Escape y restitución de foco. Tabla
  en región desplazable identificada y navegación compacta en móvil.

La UI no sustituye gates del dominio. Un botón no acredita que una evidencia sea
elegible; el servidor confirma el resultado. En tareas CODE, agentes/API registran
la evidencia CODE/TEST estructurada; el formulario web actual solo adjunta informes.

## Consistencia y recuperación

El dashboard carga todas las páginas de un mismo snapshot antes de mostrar datos.
Cada cinco segundos consulta delta; si hay cambios recarga el snapshot completo.
Sin cambios avanza el cursor. Cada minuto obtiene snapshot nuevo. No aplica
payloads parciales como si fueran entidades completas ni convierte BIGINT a Number.
Cursores expirados/inválidos, adelantados o con huecos provocan recarga de snapshot.

Desconexión, error o datos sin confirmar durante más de treinta segundos bloquean
mutaciones. Un detalle de versión distinta al contexto pide actualización explícita;
no sobrescribe un borrador con una versión nueva silenciosamente. Las mutaciones
no son optimistas: conservan clave idempotente para reintentar el mismo contenido,
y solo confirman éxito tras respuesta del servidor e invalidación de lecturas.

La expiración/cierre cancela consultas y elimina cachés de la identidad anterior;
la consulta de sesión observada cambia a anónima inmediatamente. El detalle también
separa su caché por principal. Una denegación de contexto oculta los datos previos.

No hay WS en este hito. La actualización periódica no acredita SLO de latencia ni
carga objetivo. Faltan preguntas/decisiones/requisitos, métricas específicas,
administración, edición de alcance/dependencias y gestión completa de alertas.

## Verificación histórica anterior a la migración de autenticación

El recorrido siguiente corresponde al dashboard con OIDC. Tras la migración se
comprobó el login local de escritorio. Los flujos nuevos de administración y móvil
se revisaron después: [resultado](../ADMIN_BROWSER_RESULT.json). Incluye reset,
deshabilitación, permisos y credenciales, así como la corrección de cabecera móvil.
Los resultados históricos siguientes no sustituyen esa revisión nueva.

- Build y tipos globales, lint/formato, **50 unitarias** y **67 integraciones**.
  Tres unitarias web comprueban paginación consistente y limpieza observable de
  caché al expirar sesión. Las integraciones usan PG/Keycloak/Redis reales.
- OIDC real a través del proxy: redirección desde el navegador comprobada y flujo
  Code/PKCE completado con cliente HTTP sintético, sin imprimir credenciales.
  La cookie HttpOnly resultante se cargó en el navegador aislado de revisión.
- Playwright CLI: tarea sintética OTHER creada, sesión/claim, implementación,
  evidencia aceptada, revisión/QA/cierre y DONE desde la UI. La tarea permanece
  identificada como verificación local y su sesión de trabajo quedó finalizada.
- Detalle tras recarga, tamaños **1440×900** y **390×844**, foco dentro del diálogo,
  Escape/restauración, tabla desplazable y ausencia de desbordamiento del documento.
- Desconexión real del contexto del navegador bloqueó acciones. Error 503 y rol
  de consulta se inyectaron en las respuestas de la revisión visual; se comprobó
  reintento y ausencia de mutaciones. Los permisos reales se verifican en las
  suites de API/MCP, no por esas respuestas inyectadas.
- Regresión de expiración: un 401 inicialmente dejaba datos visibles; se reprodujo
  antes de corregir y después mostró acceso anónimo en menos de tres segundos.
- Preview compilado: tarea y detalle conservados tras reiniciar la API y recargar;
  logout retiró los datos privados inmediatamente. Discovery y cliente MCP también
  funcionaron a través del proxy del origen público.

Artefactos locales ignorados en `output/playwright/`; no se suben cookies, snapshots
de sesión, trazas ni credenciales. Esta revisión no equivale a auditoría WCAG completa
ni a una suite de navegador permanente en CI.

Las integraciones HTTP usan temporalmente 55173: detener web/preview antes de
`pnpm test:integration`. La API normal en 53000 puede permanecer arrancada.

La gestión propia de agentes se comprobó con un usuario USER real, dos proyectos,
dos credenciales de la misma identidad, retiro de un proyecto y revocación
independiente. ADMIN ve cada agente en la lista de su propietario. Se revisaron
1440×900, 1024×768 y 390×844; ver [resultado](../AGENT_OWNERSHIP_RESULT.json).

El dashboard escucha `/ws/v1` para invalidar contexto y detalles al recibir
eventos, y reconcilia por delta al reconectarse. Conserva la consulta de cinco
segundos como respaldo; un evento no sustituye una entidad completa. El protocolo,
permisos y límites están en [eventos](events.md) y la comprobación en
[WEBSOCKET_RESULT.json](../WEBSOCKET_RESULT.json).
