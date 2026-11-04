# Continuar: comprobar ACC desde las herramientas de Codex

Nota explícita solicitada por el usuario al terminar esta sesión.

## Comprobación posterior completada

La integración directa ya fue comprobada al continuar: seis herramientas nativas
de Codex respondieron correctamente, las 15 referencias conservaron los IDs del
espejo y coincidieron títulos/criterios. Reintentos sin duplicados: 16 tareas antes
y después, incluidas las 15 del catálogo. Contexto completo y delta vacío en
secuencia 35. [Evidencia verificable](CODEX_MCP_RESULT.json).

Compose seguía con API/UI/PG/Redis saludables, worker activo y migrate/bootstrap
finalizados con código 0. Posteriormente se comprobó reinicio/idempotencia y se
actualizaron las guías de autenticación propia: [resultado](COMPOSE_VERIFICATION.json).
Queda validar administración web/móvil. Las secciones siguientes
conservan el procedimiento y el estado anterior a esta comprobación.

## Objetivo inmediato

Después de reiniciar Codex, validar la integración directa con el MCP `acc`.
El usuario pidió comprobar el MCP configurado en Codex: **no sustituir esta
validación por scripts, HTTP manual ni el SDK oficial**.

## Estado comprobado

- ACC fue añadido a `C:\Users\eayer\.codex\config.toml` como `mcp_servers.acc`.
- Transporte Streamable HTTP; endpoint `http://localhost:55173/mcp`; habilitado.
- Authorization está configurada en el archivo personal, fuera de Git. No
  imprimir ese bloque ni ejecutar comandos que muestren sus headers completos.
- `codex mcp get acc --json` se comprobó capturando su salida y mostrando solo
  nombre, transporte, URL, activación y presencia de autenticación.
- La sesión anterior no tenía herramientas ACC expuestas, incluso después de
  guardar la configuración. No se ha realizado ninguna llamada nativa de Codex
  a ACC: la integración directa sigue **pendiente**.
- Compose quedó funcionando: API/UI/PG/Redis saludables, worker activo y
  migrate/bootstrap con salida 0. Volver a comprobar los servicios al retomar.
- Hay 15 tareas reales importadas con el SDK oficial. Dos sincronizaciones
  conservaron los mismos IDs; lectura, contexto y delta pasaron por MCP.
  Esto verifica el gateway y el importador, no la integración de Codex.

## Primeros pasos en la nueva sesión

1. Leer README.md, COMO-TRABAJAMOS.md y esta nota; revisar Git sin descartar cambios.
2. Comprobar que las herramientas de `acc` aparecen en el inventario de Codex
   (pueden llevar un prefijo de servidor). Si no aparecen, revisar carga del MCP
   y sus errores de inicio. No declarar conectividad por tener configuración.
3. Llamar directamente a `acc_list_projects` y confirmar acceso al proyecto
   `3268b4d2-cd9d-4afc-bc76-ea631997cd73`, «ACC · Demostración local».
4. Llamar a `acc_list_tasks` con ese `projectId` y `query: {limit: 100}`. Seguir
   `nextCursor` si lo devuelve. Puede haber otras tareas: identificar las 15 por
   sus referencias `repo:dashboard:` y compararlas con `docs/acc-tasks.json`.
5. Llamar a `acc_get_task` usando un `taskId` real de
   `docs/ACC_MIRROR_RESULT.json`; contrastar título y criterios con el catálogo.
6. Reintentar `acc_find_or_create_task` para una entrada existente, conservando
   exactamente su `externalRef`, título y criterios. Leer el contrato de la
   herramienta y el mapeo en `apps/api/src/mcp/mirror.ts` antes de construir el
   input. Usar una clave de idempotencia estable para esta comprobación; confirmar
   que devuelve el mismo ID y que no aumenta el número de tareas del espejo.
7. Obtener todas las páginas de `acc_get_context` antes de conservar
   `changesCursor`; llamar a `acc_get_changes` con ese cursor. Un delta vacío es
   válido si no hubo cambios; no inventar actividad para presentar un resultado.
8. Registrar herramientas invocadas, IDs y resultados en archivos. Distinguir
   configuración, conexión, lectura y reintento realmente comprobados. Si falla,
   conservar el error sin secretos y resolverlo antes de afirmar que funciona.

## Continuidad del proyecto

Los archivos siguen como referencia principal y se duplica el seguimiento en ACC.
Ver `docs/ACC_MIRROR.md`, `docs/acc-tasks.json` y `docs/ACC_MIRROR_RESULT.json`.
Las tareas importadas están en BACKLOG: no convertir el historial documentado en
DONE ni aprobar evidencias o gates humanos como agente.

Tras validar la integración directa, continuar los pendientes de
`docs/IMPLEMENTATION_STATUS.md`: administración web y móvil, reinicio/idempotencia
de Compose y documentación de autenticación propia. Las notas antiguas de
`docs/RESUME_LOCAL_AUTH.md` conservan contexto histórico; los builds y el arranque
Docker ya se completaron después de aquella pausa.

Rama de trabajo: `feat/acc-foundation`. Hay numerosos cambios locales y archivos
nuevos; esta continuación no hizo commit ni push. No borrar volúmenes, editar la
migración 005 aplicada ni mostrar `.env` o `.cache/local-agents.json`.

Mensaje sugerido al retomar: «Lee docs/CONTINUE_CODEX_MCP.md y comprueba la
integración directa con ACC usando las herramientas MCP de Codex».
