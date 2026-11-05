# Registro de repositorios para evidencias

Estado: alternativa A aprobada por el usuario el 2026-11-05 mediante «si» a la
solicitud explícita de aprobación; implementación autorizada.

## Problema y alcance

TASK-26 tiene tiempo de trabajo implementado y desplegado, pero su cierre CODE
exige evidencias CODE y TEST del mismo repositorio/commit. El catálogo está vacío
y no existe una operación pública para registrar repositorios. No insertar filas
directamente en PostgreSQL ni cambiar el tipo de tarea para evitar ese control.

El bloque implementa la parte de catálogo de FR-001 y habilita FR-016. No declara
terminada la administración general de proyectos, ni aprueba requisitos o impacto.

## Alternativas

1. **A, recomendada: registro y consulta por REST; lectura mediante contexto/MCP.**
   Mutación humana OWNER/ADMIN/MANAGER, con cookie/CSRF, idempotencia y auditoría.
   Resuelve el bloqueo concreto sin otorgar administración de repositorios a
   agentes cuyo permiso actual es task:write. El contexto existente permite
   descubrir IDs para adjuntar evidencia por MCP.
2. **B: administración web completa y nuevas capacidades MCP.** Permite gestión
   más amplia, pero requiere acordar permisos adicionales y diseñar pantallas;
   amplía el trabajo para resolver este bloqueo.

Alternativa seleccionada por el usuario: A.

## Contrato propuesto A

- GET `/api/v1/projects/{projectId}/repositories`: consulta paginada, límites
  20/100, UUID estable y autorización de lectura del proyecto.
- POST en la misma ruta: `{name,url}` estrictos. Nombre normalizado y URL HTTPS
  absoluta sin credenciales, query o fragmento. Es metadato: no clona ni hace
  peticiones de red. Idempotency-Key obligatorio.
- Registro inmutable por proyecto y URL exacta normalizada; reintento devuelve
  el mismo ID. No fusionar proveedores, nombres similares o variantes ambiguas.
  No agregar edición/borrado ni invalidar evidencias existentes.
- La escritura utiliza el límite transaccional existente: autorización, bloqueo,
  idempotencia, entidad, audit_events y event_outbox en una transacción.
- Migración nueva para unicidad por proyecto/URL y soporte del tipo de evento
  REPOSITORY; conservar las migraciones 001–010. Actualizar contratos de eventos,
  OpenAPI y consumidores que enumeren tipos.
- El primer registro será `dashboard`, URL `https://github.com/eayero/ia-dashboard`,
  una vez implementado y disponible el contrato. No cambia rama ni remoto Git.

## Verificación y cierre

Pruebas con PostgreSQL real: reintento y concurrencia sin duplicados; claves
reutilizadas con otro payload; rechazo de agente, VIEWER y acceso cross-project;
proyecto archivado; rollback sin evento huérfano; snapshot/delta y evidencia del
repositorio correcto. Verificar REST, contrato OpenAPI, tipos, lint y suites
aplicables. No hay cambio de UI en A.

Después registrar CODE/TEST en TASK-26 con commit publicado completo y resultado
real de pruebas, manteniendo los criterios c1–c4. Nunca etiquetar pruebas nuevas
como ejecutadas sobre un commit anterior. La aprobación de REQ-19 y evaluación
de su impacto continúan siendo acciones humanas. Solo avanzar a DONE si todos
los controles del servidor se satisfacen.
