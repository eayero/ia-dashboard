# Registro explícito de tiempo de agentes

Diseño aprobado: [TASK_WORK_TIME_DESIGN.md](TASK_WORK_TIME_DESIGN.md).
Implementación local; requiere migración 009 al actualizar la instancia.

## Operaciones

| Canal | Operación                                                   | Entrada                                  |
| ----- | ----------------------------------------------------------- | ---------------------------------------- |
| REST  | POST /api/v1/projects/{projectId}/tasks/{taskId}/start-work | expectedVersion, sessionId, fencingToken |
| REST  | POST /api/v1/projects/{projectId}/tasks/{taskId}/pause-work | expectedVersion, sessionId, fencingToken |
| REST  | GET /api/v1/projects/{projectId}/tasks/{taskId}/time        | timeZone opcional                        |
| MCP   | acc_start_work                                              | projectId, taskId, idempotencyKey, input |
| MCP   | acc_pause_work                                              | projectId, taskId, idempotencyKey, input |
| MCP   | acc_get_task_time                                           | projectId, taskId, query                 |

Los POST requieren Idempotency-Key y credencial de agente con audiencia API y
task:write. MCP usa audiencia MCP y scopes existentes. Humanos consultan el
informe con sus permisos de proyecto; no pueden iniciar contadores de agentes.
El servidor resuelve identidad, propietario, reloj y duración. No acepta autor,
fechas ni duraciones elegidos por el cliente.

## Secuencia del agente

1. Registrar sesión y reclamar una tarea disponible siguiendo el flujo existente.
2. Iniciar trabajo explícitamente con la versión devuelta por el claim.
3. Conservar la última versión de tarea después de cada mutación/heartbeat.
   Renovar sesión y claim por separado; ninguno inicia un contador por sí solo.
4. Pausar antes de una espera o de terminar el tramo de trabajo. La pausa conserva
   el claim; una reanudación explícita crea otro tramo.
5. Entregar/liberar/finalizar normalmente. Cerrar o revocar el claim/sesión termina
   el tramo; caducar limita su duración aunque no se haya materializado el cierre.

Cada agente puede tener un contador activo por proyecto. Un heartbeat no reanuda
un tramo caducado. Después de recuperar el claim es necesario iniciar otro tramo.
Reintentar una petición con la misma clave/cuerpo devuelve el mismo resultado.

## Informe

La respuesta incluye asOf, timeZone, totalMilliseconds, agents, days e intervals.
Las duraciones se devuelven como enteros decimales en texto para conservar precisión.
Los intervalos guardan identidad, nombre del agente y propietario al inicio,
sesión, revisión de trabajo, inicio, fin efectivo, límite de vigencia y motivo.
Nunca se expone el fencing en el informe o snapshot público.

Por defecto se usa America/Caracas; UTC está disponible en la interfaz y la API
acepta zonas IANA válidas. Cada tramo se corta en los límites reales del calendario
de la zona elegida. Agentes, días y tarea conservan sumas exactas, incluidos días
de 23/25 horas. La UI muestra horas/minutos/segundos; el informe retiene milisegundos.

El detalle de tarea muestra total, acumulado por agente, tabla día/agente y tramos
ampliables. Actualiza el cálculo cada cinco segundos e indica hasta qué instante
está calculado. No se reconstruyen tiempos anteriores a esta funcionalidad.

## Errores

WORK_ALREADY_RUNNING y WORK_NOT_RUNNING producen conflicto; también se conservan
VERSION_CONFLICT, STALE_CLAIM, SESSION_INACTIVE e IDEMPOTENCY_KEY_REUSED.
Una zona inválida se rechaza con validación; tarea ajena o inexistente no expone
datos. Las revocaciones se comprueban de nuevo en servidor.

Contrato completo: [OpenAPI](../openapi.json). Verificaciones y límites:
[TASK_WORK_TIME_RESULT.json](TASK_WORK_TIME_RESULT.json).
