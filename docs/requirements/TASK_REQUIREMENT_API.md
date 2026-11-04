# Requisito obligatorio en API y MCP

Implementación autorizada expresamente por el usuario: la regla de que toda tarea
responde a un requisito debe imponerse en la API y formar parte del flujo MCP.

## Creación atómica

`POST /api/v1/projects/{projectId}/tasks` y `acc_find_or_create_task` exigen
`requirementIds`: entre 1 y 100 UUID únicos del mismo proyecto. El servidor valida
autorización y requisitos, bloquea las operaciones del grafo y confirma tarea,
asociaciones iniciales, evento, outbox e idempotencia en una sola transacción.
Una entrada ausente/vacía/inválida devuelve 400; requisito inexistente o ajeno, 404.
No se inventa ni escoge un requisito por defecto.

```json
{
  "title": "Implementar acceso seguro",
  "criteria": [{ "id": "a", "description": "Acceso verificado", "required": true }],
  "requirementIds": ["26564011-7a1b-4294-8f68-4b1a1c483c08"]
}
```

La orden actual del usuario habilita la asociación inicial como parte de crear
la tarea por agente/MCP, complementando Q24. Si el requisito ya está aprobado,
su revisión es la base inicial de la tarea; esto no genera una evaluación humana
de impacto ni aprueba contenido. Un DRAFT mantiene `impactPending=true` y las
transiciones de revisión/cierre siguen bloqueadas hasta resolver aprobación e
impacto. Aprobar requisitos, evaluar cambios posteriores y modificar vínculos de
tareas existentes conservan la autorización humana establecida.

Un reintento con la misma clave/payload recupera la respuesta original. Una
referencia externa exacta existente devuelve la tarea existente y conserva sus
asociaciones; no añade ni sustituye requisitos por la vía de recuperación.
Revisar título/criterios de una tarea tampoco permite cambiar sus vínculos.

## Protección de la última asociación

Retirar el último vínculo devuelve `409 TASK_REQUIREMENT_REQUIRED`. Para sustituir
alcance, asociar primero el nuevo requisito. Las operaciones se serializan por
proyecto para evitar que retiradas simultáneas creen una tarea huérfana.

La migración **010_task_requirement_required.sql** añade una restricción diferida
en PostgreSQL: al confirmar, cada tarea existente debe conservar al menos un
vínculo. Protege inserciones/actualizaciones de tareas y retiradas/traslados de
vínculos; también prohíbe truncar la tabla de asociaciones. Permite insertar tarea
y vínculo en la misma transacción. No modifica las migraciones 001–009.

Antes de migrar, todas las tareas existentes deben estar asociadas; si no, la
migración falla sin rellenar ni aprobar datos por su cuenta. La API comprueba la
presencia del trigger al arrancar. La migración se probó en esquemas aislados;
todavía no se aplicó al servicio habitual.

## Flujo MCP

1. Obtener todas las páginas de contexto y consultar requisitos con
   `acc_list_requirements` / `acc_get_requirement`.
2. Identificar el alcance real; si falta, proponerlo con
   `acc_register_requirement`, sin inventar aprobación.
3. Buscar tareas existentes; crear con `acc_find_or_create_task` y
   `input.requirementIds`, referencia exacta y clave idempotente.
4. Leer `acc_get_task` y el requisito para comprobar asociaciones en ambos sentidos.
5. Registrar sesión, reclamar, iniciar/pausar tiempo y ejecutar el flujo de trabajo.
   La falta de aprobación o impacto pendiente sigue respetando los gates existentes.
6. Reconciliar detalle, contexto/delta y ejecutar `pnpm requirements:check`.

El importador del catálogo obtiene IDs reales desde TRACEABILITY y falla antes de
crear si un trabajo no tiene requisito. El formulario web carga el catálogo,
exige seleccionar alcance y bloquea la creación cuando no hay requisitos.

Resultado: [TASK_REQUIREMENT_API_RESULT.json](TASK_REQUIREMENT_API_RESULT.json).

Instancia local actualizada con el contrato obligatorio y migración 010, commit
`94d7a34`; las notas anteriores de despliegue pendiente son históricas.
Ver [despliegue verificado](TASK_REQUIREMENT_DEPLOYMENT.json).
