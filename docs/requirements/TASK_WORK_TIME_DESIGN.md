# Tiempo de trabajo por tarea y agente

Estado: aprobado por el usuario para implementar. Fuente: petición del usuario del 2026-11-04.
El usuario eligió expresamente «Inicio y pausa explícitos».

## Resultado esperado

Cada tarea muestra el tiempo acumulado por los agentes, los días en que trabajaron
y cuánto aportó cada agente. El tiempo empieza solo con una acción explícita del
agente; tener una sesión o claim no inicia un contador automáticamente.

## Enfoque elegido y alternativas

Se eligieron intervalos de inicio/pausa explícitos. Se descartaron el cómputo de
todo el claim (incluye esperas) y las duraciones manuales (sin un reloj verificable).
Todos los tiempos se calculan con el reloj PostgreSQL. El navegador presenta el
resultado y no puede enviar una duración, un autor o una fecha de inicio elegidos.

## Reglas propuestas

- Un agente con claim y sesión ACC vigentes inicia el trabajo de una tarea
  IN_PROGRESS. La identidad y propietario se resuelven en servidor.
- Pausar cierra el tramo y conserva su duración. Reanudar crea otro tramo;
  el total es la suma de los tramos registrados, sin contar las pausas.
- Una identidad agente no puede tener dos contadores activos en el mismo proyecto.
  El historial de sesiones distintas conserva la misma identidad del agente.
- Cada tramo queda ligado a proyecto, tarea, agente, sesión y fencing del claim.
  Se conservan también nombre del agente y propietario al iniciarlo para trazabilidad.
- Entregar a review/QA, liberar/revocar claim, finalizar/revocar sesión o perder
  acceso cierra el tramo automáticamente. Es un límite de seguridad; el inicio
  sigue siendo explícito. Caducidad de claim/sesión limita el tiempo aunque el
  proceso que expiraría registros no haya corrido.
- Heartbeat renueva el límite de un tramo que sigue activo; no reanuda un tramo
  ya caducado. Tras caducar, hay que recuperar el claim e iniciar otro tramo.
- Inicio y pausa son idempotentes y verifican versiones. Una respuesta perdida
  no crea tramos duplicados ni suma dos veces. Los agentes no alteran el historial.
- La primera entrega registra agentes. El trabajo humano y las correcciones
  manuales de duraciones quedan fuera de alcance.
- No inventar tiempo anterior: las tareas existentes comienzan sin tramos.
  El historial de claims no permite reconstruir inicios/pausas que no se registraron.

## Fechas y totales

Guardar instantes UTC con precisión de milisegundos. El informe diario usa por
defecto America/Caracas (zona de esta sesión) y puede consultarse en UTC.
Si un tramo atraviesa medianoche, repartir su duración entre los días afectados.
La suma de días y agentes debe coincidir con el total de la tarea. Los cambios
de horario de zonas IANA se resuelven según sus límites reales, no con días fijos
de 24 horas. No sumar el tiempo completo de un tramo a cada día que toca.

Devolver totalMilliseconds, totales por agente y filas por fecha/agente, además
de los intervalos con inicio, fin efectivo, estado y motivo del cierre. Una lectura
incluye asOf para indicar el instante hasta el que se calculó un tramo activo.

## API, MCP e interfaz

Extender comandos compartidos con startWork y pauseWork, y herramientas MCP
acc_start_work, acc_pause_work y acc_get_task_time. REST equivalente por tarea;
lecturas autorizadas al proyecto y mutaciones con sesión/claim/versiones e
Idempotency-Key. Los comandos conservan mutación, auditoría y outbox atómicos.

Presentación considerada:

1. Resumen y tabla fecha/agente dentro del detalle de tarea (recomendada): permite
   consultar el esfuerzo junto al resultado y reutiliza el patrón actual.
2. Pestaña separada «Tiempo»: más espacio, pero añade un paso de navegación.
3. Vista global de informes: facilita comparar tareas, pero amplía el alcance.

Se propone 1: total visible y tabla con día, agente y duración; intervalos ampliables
para revisar inicios/pausas. Es una consulta humana, sin botones para suplantar a
un agente. Los agentes controlan inicio y pausa mediante API/MCP.

## Persistencia y controles

Migración nueva posterior a 008, sin modificar migraciones aplicadas ni datos
anteriores. Intervalos ligados mediante FK compuestas; restricciones impiden
duraciones negativas y solapamientos de contadores activos en el mismo proyecto.
Coordinar los cierres con los mecanismos existentes de claim, sesión y revocación.
La reapertura de una tarea conserva el tiempo previo y permite nuevos intervalos.
Contexto/delta/WS y OpenAPI incorporan el seguimiento sin exponer credenciales.

## Verificación

PostgreSQL real: inicio/pausa/reanudación, dos inicios concurrentes, reintentos,
fencing obsoleto, expiración, finalización/revocación, heartbeat y pérdida de
acceso. Comprobar reparto a medianoche, varios días y zonas con cambio horario,
sumas exactas, aislamiento entre proyectos y rollback si falla auditoría/outbox.
REST/MCP prueban el mismo comportamiento. Navegador real comprueba la tabla y
el total por agente en escritorio/móvil, vacío y lectura de tramos activos.

El usuario aprobó este diseño expresamente. No modifica las reglas
de aprobación de requisitos ni sustituye la entrega de su interfaz ya en curso.
