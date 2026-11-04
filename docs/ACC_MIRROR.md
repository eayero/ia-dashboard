# Seguimiento en archivos y ACC

Los archivos del repositorio son la referencia principal. ACC mantiene una copia
operativa de las tareas para comprobar el producto con trabajo real. Las decisiones
siguen en DECISIONS.md, los requisitos en SPECIFICATION.md y las verificaciones en
IMPLEMENTATION_STATUS.md. Una copia en ACC no sustituye esos documentos.

El catálogo es [acc-tasks.json](acc-tasks.json). Cada entrada tiene un identificador
estable, archivo de origen, contexto y criterios. Las referencias `repo:dashboard:`
permiten repetir la importación sin crear tareas duplicadas. Los hitos históricos
se importan en BACKLOG: el estado documentado no equivale a aprobación de ACC.
El agente puede recorrer todos los estados válidos, incluido DONE, sin aprobación
humana previa. La validación humana posterior es un OK de auditoría separado.

## Duplicación obligatoria de todo el trabajo

Por instrucción expresa del usuario, todo trabajo debe tener reflejo mediante MCP:
implementación, correcciones, documentación, decisiones, pruebas, revisión y
publicación. Cada bloque conserva tarea/referencia, alcance, avance, resultados,
evidencias y pendientes. Los documentos completos permanecen en archivos; ACC
recibe su contexto y enlaces. No copiar secretos ni artefactos privados de sesión.

1. Consultar `acc_list_projects`, seleccionar el proyecto y pasar `projectId` en
   cada llamada. Aquí se usa `3268b4d2-cd9d-4afc-bc76-ea631997cd73`.
2. Listar tareas y terminar todas las páginas de contexto. Reutilizar `externalRef`
   exacta; crear solo trabajo que falte con clave idempotente estable.
3. Registrar sesión ACC. En tareas habilitadas, adquirir claim y registrar avances
   con `acc_update_task`, renovando sesión y claim por separado.
4. Adjuntar evidencias HTTPS con `acc_add_evidence` bajo los requisitos vigentes.
   Recorrer revisión, QA y DONE con `acc_transition_task`, sin aprobaciones humanas.
   La validación posterior a DONE se registra por una persona y no cambia estado.
5. Al terminar el bloque, reflejar verificaciones, commit/push y pendientes;
   comprobar detalle/delta y finalizar sesión. Registrar en archivos IDs y resultado.

READY ya puede establecerlo el agente con task:write. Las tareas BACKLOG deben
pasar a READY antes del claim y la evidencia de implementación. La evidencia
declarada elegible permite avanzar sin aceptación humana previa.
`acc_update_task` exige claim vigente; no existe edición libre
de contexto, comentarios o documentos por MCP. Si estas restricciones impiden
copiar un avance, registrarlo explícitamente y conservar una conciliación con
referencias a las tareas, sin crear tareas sustitutas ni modificar sus criterios.
Si falta un campo o herramienta para duplicar información, registrar la carencia;
no declarar sincronización completa ni escribir directamente en la BD para eludirla.

La conciliación actual está en [ACC_WORK_SYNC.json](ACC_WORK_SYNC.json). La nueva
tarea ACC-LOCAL-016 recoge esta petición y el resumen del trabajo publicado; las
15 tareas anteriores conservan sus IDs y criterios. Es un registro consolidado,
no una aceptación de evidencias ni un cierre retroactivo de esas tareas.

Ese informe conserva las restricciones anteriores como registro histórico. La
decisión posterior de estados autónomos las sustituye; su implementación y
comprobación se registran en [AGENT_WORKFLOW_RESULT.json](AGENT_WORKFLOW_RESULT.json).

## Conciliación posterior del trabajo publicado

ACC-LOCAL-010 (documentación de autenticación) y ACC-LOCAL-012 (reinicio/bootstrap
de Compose) se conciliaron mediante MCP nativo hasta DONE, bajo sesión y claim.
Se adjuntaron enlaces reales al commit `c273f4d`, con resumen y criterios
correspondientes. El agente las cerró sin validarlas. Después ACC registró una
validación humana para ACC-LOCAL-012; ACC-LOCAL-010 seguía pendiente de OK humano
en la lectura de conciliación. DONE y validación siguen siendo hechos distintos.
Los IDs, versiones y evidencias se conservan en
[ACC_WORK_SYNC.json](ACC_WORK_SYNC.json). No se alteraron los criterios originales.

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

Las comprobaciones de Compose/bootstrap y actualización de guías se publicaron
en el commit `c273f4d`, con URLs HTTPS reales. Están referenciadas en la conciliación
MCP. Su asociación formal a ACC-LOCAL-012 y ACC-LOCAL-010 ya se completó bajo claim
y ambas tareas llegaron a DONE. Queda sustituida la habilitación humana anterior;
el agente no emitió el OK humano posterior. No modificar criterios históricos ni inventar
evidencias para simular validación.
