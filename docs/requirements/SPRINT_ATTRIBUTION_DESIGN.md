# Autoría, participantes y sprints heredados

Estado: DISEÑO A APROBADO por el usuario («continua»). Fecha: 2026-11-05.
Trabajo: ACC-LOCAL-024 / TASK-30. Implementación local; sin publicación ni despliegue de esta función.

## Encargo y decisiones confirmadas

El usuario solicita creador y participantes en tareas y requisitos, identificados
por el agente autenticado mediante MCP y su usuario propietario; tiempo empleado
por participante en cada tarea; sprints con estados y ejecución restringida al
sprint en ejecución; reasignación de requisitos y tareas.

Confirmado por el usuario: las tareas heredan el sprint; opción A, un requisito
principal determina ese sprint y los vínculos restantes mantienen trazabilidad.
La propuesta siguiente concreta los detalles aún no definidos por el usuario.

Base: FR-002, FR-003, FR-004, FR-019 y NFR-003; stack y diseño visual actuales.
No cambia aprobación de requisitos/impacto ni validación humana posterior a DONE.

## Alternativas consideradas

1. **A elegida:** requisito principal por tarea y enlaces secundarios. El sprint
   procede exclusivamente del principal; conserva requisitos transversales.
2. B descartada: todos los requisitos de una tarea comparten sprint. Impide
   vínculos transversales con requisitos de otras iteraciones.
3. Sprint directo en tarea descartado: contradice la herencia pedida y permite
   desalinear tarea y requisito.

## Identidad y participantes

El servidor obtiene el actor de la autenticación, nunca de campos enviados por
el cliente. Para MCP registra ID/nombre del agente, usuario propietario, canal
MCP y sesión ACC cuando existe; no expone token, secreto ni nombre de configuración
local como identidad verificable. Una credencial nueva del mismo agente no crea
otro participante. Para acciones humanas identifica al usuario y canal WEB/API.

Cada entidad muestra creador: actor, usuario propietario si es agente, fecha y
canal cuando la evidencia lo permite. La autoría original es inmutable. Las
nuevas creaciones conservan identificación histórica del propietario, sin
reinterpretar el pasado si cambia el nombre o estado de la cuenta.

Participantes son actores de **mutaciones confirmadas** en esa entidad: crear,
editar, asociar, reasignar, reclamar, registrar trabajo, aportar evidencia y cambiar
estado, según las operaciones existentes. Lecturas, fallos y repeticiones
idempotentes no incrementan actividad. Participantes incluyen humanos y agentes.
Se exponen primera/última intervención, acciones y usuario/agente identificables.
La participación en una tarea no se presenta como edición directa del requisito:
en este se separan participantes directos y colaboradores en sus tareas.

La auditoría append-only es la fuente. Una proyección indexada puede acelerar
consultas pero debe actualizarse en la misma transacción y ser reconstruible.
Deshabilitar una cuenta no borra su contribución. Los datos heredados muestran
«origen no registrado» o usuario desconocido si no hay evidencia suficiente;
no se inventa el canal MCP ni se atribuye retrospectivamente un propietario.

## Tiempo

Se reutilizan intervalos existentes con inicio/pausa explícitos, sesión/claim,
fencing y reloj PostgreSQL. Interactuar no inicia un contador. Participante sin
intervalos: «0 registrado»; no equivale a ausencia de esfuerzo real.

En tareas se muestran tiempo por agente, total registrado por usuario propietario,
desglose diario y tramos. El usuario humano no recibe un intervalo ficticio por
sus acciones web; su total agrupa los intervalos de sus agentes. La interfaz
explica esa procedencia. Los totales son tiempo de agente, no duración de reloj:
dos agentes paralelos suman ambos tiempos. No hay doble conteo de un intervalo.

En requisitos se muestra por separado el tiempo de tareas cuyo requisito principal
es ese requisito, con detalle por tarea/agente/usuario. Los vínculos secundarios no
duplican el tiempo. La propuesta atribuye los tramos al requisito principal y al
sprint vigentes **al iniciar cada tramo**: reasignar no traslada esfuerzo histórico.
Los intervalos previos sin esa referencia quedan identificados como históricos
sin asignación; mantienen su tarea, duración y propietario originales.

## Sprints y asignación

Se implementa la entidad iteration prevista en la especificación, llamada «Sprint»
en la UI. ID público ITER-n, meta, nombre, fechas previstas, autor, versión y
estado. Las fechas no cambian estados automáticamente. Se valida inicio <= fin.

Estados propuestos:

| Estado                 | Permite trabajar | Transiciones                 |
| ---------------------- | ---------------- | ---------------------------- |
| PLANNED / Planificado  | No               | ACTIVE, CANCELLED            |
| ACTIVE / En ejecución  | Sí               | PAUSED, COMPLETED, CANCELLED |
| PAUSED / Pausado       | No               | ACTIVE, CANCELLED            |
| COMPLETED / Finalizado | No               | Terminal                     |
| CANCELLED / Cancelado  | No               | Terminal                     |

Como máximo un sprint ACTIVE por proyecto, incluido reanudar, protegido por índice
parcial y transacciones. Crear, editar y cambiar estados exige humano con rol
OWNER/ADMIN/MANAGER; MCP permite lectura del plan y sus restricciones.

Cada requisito tiene cero o un sprint. Sin sprint es backlog y se puede redactar,
revisar y planificar. Cada tarea nueva exige requisito principal dentro de sus
requirementIds; se conserva la creación atómica con vínculos obligatorios.
Una tarea heredada puede quedar pendiente de elegir principal hasta planificarse.
Nunca se puede retirar el vínculo principal sin sustituirlo atómicamente por otro
requisito vinculado del mismo proyecto. Los vínculos secundarios conservan sus
controles actuales de aprobación/impacto.

Reasignar requisito a otro sprint cambia el sprint efectivo de todas sus tareas
principales; cambiar principal mueve una tarea al sprint de su nuevo requisito.
Ambas operaciones necesitan humano gestor, versiones actuales, motivo y auditoría.
Permiten volver a backlog sin borrar trabajo, tiempos, evidencias ni estados.
Se rechaza reasignación de requisitos/tareas con claim vigente o tiempo en curso:
primero deben detenerse y liberarse. No se reabren tareas DONE automáticamente.
Un sprint terminal no acepta nuevas asignaciones. Mover una tarea no aprueba
requisitos ni elimina controles de impacto.

## Controles de ejecución

REST y MCP comparten las mismas operaciones transaccionales de dominio/BD.
Se verifica el sprint heredado en la transacción, con orden de locks consistente
para impedir carreras con reasignaciones, pausas y finalizaciones de sprint.

Necesitan principal, sprint ACTIVE y los controles existentes:

- adquirir/renovar claim, entrar o volver a IN_PROGRESS e iniciar trabajo;
- actualizar implementación, adjuntar evidencia y avanzar a IN_REVIEW/IN_QA/DONE.

Se permiten fuera de sprint activo: consultar, planificar, crear propuestas,
asignar, pausar tiempo, liberar claim, finalizar sesión, bloquear y cancelar según
permisos actuales. No se impide detener trabajo ni administrar el backlog.
La revisión de requisitos y la evaluación humana de impacto siguen disponibles
para preparar trabajo antes del sprint.

Pausar, finalizar o cancelar un sprint cierra intervalos efectivos a la hora de
la transacción y revoca claims de sus tareas principales; no cambia los estados
de las tareas ni borra evidencias. Un agente con fencing anterior no puede seguir
escribiendo. Reanudar exige adquirir claim e iniciar un nuevo tramo explícito.
Finalizar permite pendientes, pero exige motivo y muestra sus cantidades antes
de confirmar; esos pendientes deberán reasignarse a otro sprint para continuar.

Errores estables propuestos: PRIMARY_REQUIREMENT_REQUIRED,
PRIMARY_REQUIREMENT_MUST_BE_LINKED, SPRINT_REQUIRED, SPRINT_NOT_ACTIVE,
ACTIVE_SPRINT_EXISTS, SPRINT_TERMINAL, ASSIGNMENT_WORK_ACTIVE y VERSION_CONFLICT.
Las respuestas de bloqueo explican el requisito/sprint causante sin filtrar
entidades ajenas al proyecto.

## Contratos y presentación

REST añade gestión de iterations, asignación de sprint a requisitos, cambio de
principal de tareas y consultas de participantes. GET de tareas/requisitos y
contexto/delta exponen autoría, principal, sprint heredado y causas de bloqueo.
Los campos agregados no filtran credenciales. MCP añade lectura de sprints y
participantes; creación de tarea acepta principal explícito. OpenAPI y esquemas
MCP describen los mismos contratos; consumidores WS reconocen ITERATION.

UI mantiene navegación y estilo aprobados. Sección Sprints con tabla de estado,
meta, fechas y cantidades; requisitos agrupables/filtrables por sprint; detalle
de tarea muestra principal, sprint heredado, creador, participantes y tiempo.
No hay selector independiente de sprint en tarea. Acciones no disponibles muestran
el motivo del bloqueo. Se cubren carga, vacío, error, permiso insuficiente y
contexto desactualizado en escritorio y móvil.

Alternativas visuales consideradas: tabla con agrupación (propuesta por coherencia
con ACC), tablero por estados (menos útil para fechas y trazabilidad) y calendario
de sprints (oculta relaciones y requiere más navegación). La tabla reutiliza
componentes existentes; no incorpora una librería visual nueva.

## Migración y compatibilidad

Nueva migración 012; no editar 001–011. No inventa sprints ni activa ninguno.
Una tarea con exactamente un vínculo puede adoptar ese requisito como principal;
con varios queda pendiente de selección humana, sin elegir por orden de UUID.
Se conserva el vínculo obligatorio de todas las tareas y se añade integridad
compuesta para principal vinculado y sprint del mismo proyecto.

Estados, datos, aprobaciones, auditoría, tiempos y credenciales existentes se
conservan. La activación del nuevo código bloquea trabajo no planificado en sprint,
incluidas tareas históricas IN_PROGRESS, sin cambiarlas de estado. El despliegue
requiere respaldar y detener API/worker durante la migración, cerrar intervalos
abiertos y revocar claims con hechos de auditoría, antes de volver a habilitar
escrituras. Esta operación se implementa en un comando de preparación auditable,
no mediante edición directa de datos para eludir contratos. El plan detallará su
orden, compatibilidad y comprobación; no se ejecuta por aprobar este documento.

## Verificación y límites

Pruebas unitarias de contratos/estados; integraciones con PostgreSQL real para
aislamiento, permisos, principal obligatorio, intervalos, reasignaciones y carreras
de sprint/claim/inicio de trabajo; idempotencia sin duplicar participantes;
relectura de creador/propietario/canal por MCP y REST; snapshot/delta y WS;
migración desde datos con uno/varios vínculos y tiempos históricos. Suite aplicable
completa, tipos/lint/formato/OpenAPI/build, auditoría de cobertura y navegador real
1440x900 y 390x844. No instalar dependencias ni relajar controles existentes.

Fuera de alcance: estimaciones de tiempo, cronómetro inferido por lecturas,
planificación automática, varios sprints activos, fechas que inician sprints,
reconstrucción ficticia del historial y validaciones humanas por el agente.

## Revisión del diseño y siguiente paso

Autorrevisión secuencial, no independiente: se contrastó el diseño con vínculos
múltiples, intervalos explícitos existentes, auditoría actor/actorUserId, gates de
impacto y compatibilidad de datos. No se lanzan subagentes: las reglas locales
exigen autorización específica y no está concedida para este encargo.

Las decisiones de estados, permisos, pausas, atribución temporal y migración aquí
descritas son propuestas del agente; solo herencia y opción A están confirmadas.
Tras aprobación del documento: preparar plan detallado e implementar por bloques
verificables. No hay autorización nueva de commit/push/despliegue de esta función.
