# Flujo autónomo y validación humana posterior

Decisión expresa del usuario: el agente puede cambiar a todos los estados. Una
persona puede validar una tarea DONE sin cambiar su estado, dejando un OK auditable.

Se mantienen las transiciones válidas, motivos, permisos de proyecto, scopes,
idempotencia, versiones, claims, dependencias y evidencias técnicas. Las evidencias
declaradas elegibles permiten avanzar; no requieren aceptación humana previa.
REVIEW/QA/CLOSURE históricos se conservan y dejan de bloquear estados.

La validación se registra por un humano con permisos de escritura en el proyecto,
solo en DONE, sobre la revisión y finalización vigentes. Guarda autor, fecha y
nota opcional. Incrementa versión técnica y secuencia de auditoría, sin cambiar
estado ni revisión de trabajo. Cada finalización admite un OK; reabrir conserva
su registro y deja la siguiente finalización pendiente de validación.

Se reutilizan dominio, contratos y store actuales; una migración adicional añade
la validación append-only y la versión de finalización. REST expone el comando
humano y el detalle/contexto muestran historial y vigencia. MCP conserva sus
herramientas de agente para todas las transiciones, sin permitir dar el OK humano.
La UI reemplaza aprobaciones obligatorias por Validar tarea y muestra ambos hechos
por separado: completada y validada.

Alternativas descartadas: permitir solo READY deja los demás estados bloqueados;
crear un estado VALIDATED contradice la petición. No se modifica historia aplicada.

Verificación: agente real por MCP hasta DONE sin aprobaciones, validación humana
por REST, idempotencia/concurrencia, rechazo a agente/VIEWER, reapertura y nueva
finalización, persistencia/contexto y auditoría. Revisión visual de UI y tamaños.
