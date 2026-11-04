# Estado actual de ACC

Fecha de adopción: 2026-11-04. Fase del producto: IMPLEMENTING; MVP incompleto.
Encargo activo: ACC-LOCAL-014 / TASK-15. El usuario pidió continuar el desarrollo,
eligió requisitos versionados y aprobó [el diseño](../requirements/VERSIONED_REQUIREMENTS_DESIGN.md).
Entrega local por REST/MCP: revisiones inmutables, aprobación humana Q23,
supersesión, vínculos e impacto Q24; contexto/delta, outbox y OpenAPI actualizados.
La [migración ECC](../process/migrations/2026-11-04-ecc/RESULT.json) previa se conserva.

Código base publicado: `0c347e0`; seguimiento publicado: `edaf57d`, rama observada
`feat/acc-foundation`. [Publicación verificable](../PUBLICATION_RESULT.json).
La base publicada acreditó 56 unitarias/92 integraciones. Las comprobaciones del
bloque actual y sus límites están en [el resultado](../requirements/VERSIONED_REQUIREMENTS_RESULT.json).
Cambios de producto y protocolo siguen locales, sin commit/push ni despliegue.

Disponible en código: tareas/claims/idempotencia, autenticación propia y agentes por
usuario/proyectos múltiples, contexto/delta, outbox/WS, dashboard, requisitos por
API/MCP y OpenAPI. Pendiente: UI de requisitos, entidades de decisiones/preguntas e
impacto correspondiente, iteraciones, creación general de proyectos, revalidación
de Claude MCP y restantes métricas/operación/CI del MVP. [Tareas](../tasks/TASKS.md).
La migración 008 solo se ejecutó en esquemas aislados de prueba; la instancia local
en servicio conserva su versión previa hasta una actualización autorizada.

## Restricciones y sustituciones vigentes

- No reinstalar Keycloak/OIDC: sustituidos por identidad propia ACC.
- No reinstalar gates humanos previos: agente recorre estados válidos; OK humano
  después de DONE. No recrear apps/mcp o paquetes propuestos solo porque figuren
  en la especificación: el gateway actual está en apps/api.
- No editar migraciones aplicadas ni borrar volúmenes. El desarrollo funcional de
  requisitos está autorizado; no hay autorización para instalaciones, publicación
  ni despliegue. La restricción anterior de solo protocolo pertenecía a ACC-LOCAL-019.
- Roles generados no acreditan subagentes ejecutados ni skills cargadas por Claude.

Continuidad: [handoff](../handoffs/LATEST.md), [decisiones](../decisions/DECISIONS.md),
[historial anterior preservado](../IMPLEMENTATION_STATUS.md). No añadir cronologías
al arranque: actualizar este resumen y guardar detalle por trabajo.
