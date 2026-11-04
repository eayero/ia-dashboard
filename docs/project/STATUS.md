# Estado actual de ACC

Fecha de adopción: 2026-11-04. Fase del producto: IMPLEMENTING; MVP incompleto.
Encargo activo: ACC-LOCAL-020 / TASK-26 y ACC-LOCAL-014 / TASK-15. El usuario pidió continuar el desarrollo,
eligió requisitos versionados y aprobó [el diseño](../requirements/VERSIONED_REQUIREMENTS_DESIGN.md).
Entrega local por REST/MCP: revisiones inmutables, aprobación humana Q23,
supersesión, vínculos e impacto Q24; contexto/delta, outbox y OpenAPI actualizados.
La [migración ECC](../process/migrations/2026-11-04-ecc/RESULT.json) previa se conserva.

Código base publicado: `0c347e0`; seguimiento publicado: `edaf57d`, rama observada
`feat/acc-foundation`. [Publicación verificable](../PUBLICATION_RESULT.json).
La base publicada acreditó 56 unitarias/92 integraciones. Las comprobaciones del
bloque actual y sus límites están en [el resultado](../requirements/VERSIONED_REQUIREMENTS_RESULT.json).
Requisitos y protocolo publicados en `ee55b37` en origin/feat/acc-foundation;
despliegue local verificado en http://localhost:55173. Ver
[resultado del despliegue](../requirements/VERSIONED_REQUIREMENTS_DEPLOYMENT.json).

Disponible en código: tareas/claims/idempotencia, autenticación propia y agentes por
usuario/proyectos múltiples, contexto/delta, outbox/WS, dashboard, requisitos por
API/MCP y OpenAPI, UI de requisitos y registro explícito de tiempo. Pendiente: entidades de decisiones/preguntas e
impacto correspondiente, iteraciones, creación general de proyectos, revalidación
de Claude MCP y restantes métricas/operación/CI del MVP. [Tareas](../tasks/TASKS.md).
Migración 008 aplicada a la instancia local. API/UI/PG/Redis saludables, worker activo;
19 herramientas MCP, contexto/delta y conservación de datos/credenciales verificados.
ACC-LOCAL-019 está DONE con evidencia publicada; su validación de runtimes sigue
siendo estática, sin ejecución de agentes. ACC-LOCAL-014 continúa IN_PROGRESS por
las otras entidades pendientes.

Continuación actual implementada localmente: UI de requisitos alternativa A,
aprobada y comprobada en navegador real, y registro de tiempo por agente con
inicio/pausa explícitos, aprobado como ACC-LOCAL-020 / TASK-26. Resultados:
[interfaz](../requirements/REQUIREMENTS_UI_RESULT.json) y
[tiempo](../requirements/TASK_WORK_TIME_RESULT.json). Cada tarea muestra total,
agentes y días; no se reconstruye tiempo histórico. La migración 009 solo se aplicó
a esquemas aislados. La instancia desplegada sigue en la entrega previa, con 008
y 19 herramientas; el código local tiene 22. No se ha publicado esta continuación.

## Restricciones y sustituciones vigentes

- No reinstalar Keycloak/OIDC: sustituidos por identidad propia ACC.
- No reinstalar gates humanos previos: agente recorre estados válidos; OK humano
  después de DONE. No recrear apps/mcp o paquetes propuestos solo porque figuren
  en la especificación: el gateway actual está en apps/api.
- No editar migraciones aplicadas ni borrar volúmenes. El usuario autorizó commit,
  push y despliegue local de la entrega previa; realizados sin merge ni instalaciones.
  Producción no está configurada. La restricción anterior de solo protocolo
  pertenecía a ACC-LOCAL-019.
- Roles generados no acreditan subagentes ejecutados ni skills cargadas por Claude.

Continuidad: [handoff](../handoffs/LATEST.md), [decisiones](../decisions/DECISIONS.md),
[historial anterior preservado](../IMPLEMENTATION_STATUS.md). No añadir cronologías
al arranque: actualizar este resumen y guardar detalle por trabajo.
