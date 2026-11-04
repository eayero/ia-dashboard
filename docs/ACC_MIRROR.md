# Seguimiento en archivos y ACC

Los archivos del repositorio son la referencia principal. ACC mantiene una copia
operativa de las tareas para comprobar el producto con trabajo real. Las decisiones
siguen en DECISIONS.md, los requisitos en SPECIFICATION.md y las verificaciones en
IMPLEMENTATION_STATUS.md. Una copia en ACC no sustituye esos documentos.

El catálogo es [acc-tasks.json](acc-tasks.json). Cada entrada tiene un identificador
estable, archivo de origen, contexto y criterios. Las referencias `repo:dashboard:`
permiten repetir la importación sin crear tareas duplicadas. Los hitos históricos
se importan en BACKLOG: el estado documentado no equivale a aprobación de ACC.
Los gates humanos se mantienen; el agente no acepta evidencias ni aprueba cierres.

## Integración directa con Codex

ACC está añadido a la configuración personal de Codex como `acc`, con transporte
Streamable HTTP, URL `http://localhost:55173/mcp` y Authorization configurada fuera
del repositorio. `codex mcp get acc --json` confirmó nombre, transporte y activación
sin mostrar la credencial. Esta comprobación valida configuración, no conectividad.

La sesión que hizo la importación no tenía herramientas ACC expuestas y verificó
la copia con el SDK oficial. Después de recargar, la integración directa quedó
comprobada con las herramientas nativas de Codex. Evidencia independiente de la
importación: [CODEX_MCP_RESULT.json](CODEX_MCP_RESULT.json).

Se invocaron `acc_list_projects`, `acc_list_tasks`, `acc_get_task`,
`acc_find_or_create_task`, `acc_get_context` y `acc_get_changes`. Las 15 referencias
exactas devolvieron los IDs previos; títulos y criterios coincidieron con el
catálogo. El reintento de BOOT-001 conservó ID y versión. La lista mantuvo 16 tareas
(15 del espejo y una previa), sin páginas pendientes. El contexto completo y el
delta vacío conservaron la secuencia 35. No hubo transiciones ni aprobaciones.

Para repetir la comprobación, ejecutar directamente `acc_list_projects`, `acc_list_tasks` para el
proyecto `3268b4d2-cd9d-4afc-bc76-ea631997cd73` y `acc_get_task` para un ID de
ACC_MIRROR_RESULT.json. Verificar las 15 referencias `repo:dashboard:` siguiendo
todas las páginas. Reintentar `acc_find_or_create_task` con una entrada del catálogo
y confirmar que devuelve el mismo ID. Registrar los resultados sin usar un script
como sustituto de las llamadas nativas de Codex.

Usamos inicialmente el proyecto local existente, «ACC · Demostración local».
El MCP actual no ofrece creación de proyectos ni almacenamiento de documentos.
Los documentos se enlazan como contexto de las tareas; no se simulan esas entidades.

Desde la raíz, `node --env-file=.env --import tsx apps/api/src/mcp/mirror.ts`
sincroniza las tareas mediante el SDK oficial y el proxy MCP de la UI. Lee secretos
solo de `.cache/local-agents.json` y escribe el resultado público en
`docs/ACC_MIRROR_RESULT.json`. Verifica lectura por ID, reintento sin duplicados,
contexto completo y delta. No modifica tareas existentes si detecta diferencias:
las comunica como conflicto para conservar ediciones humanas y cambios de alcance.

Al trabajar, actualizar primero los archivos y después su copia en ACC. Si ACC
no está disponible, conservar el trabajo en archivos y registrar la sincronización
pendiente. No declarar terminada una tarea por haberla importado.

Las comprobaciones posteriores de Compose/bootstrap y actualización de guías se
registran en [COMPOSE_VERIFICATION.json](COMPOSE_VERIFICATION.json) y en el estado
de implementación. La asociación de esa evidencia a ACC-LOCAL-012 y ACC-LOCAL-010
sigue pendiente: el archivo es local, sin URL HTTPS publicada, y MCP exige HTTPS
para adjuntar evidencias. No sustituirlo por una URL inventada ni modificar los
criterios históricos del catálogo para simular una aprobación.
