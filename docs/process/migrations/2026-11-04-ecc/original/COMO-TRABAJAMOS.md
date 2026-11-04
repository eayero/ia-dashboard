# Cómo trabajamos en ia-dashboard

Guía compartida para personas, Codex y Claude.

## 1. Contexto del proyecto

El repositorio contiene especificación, acuerdos, monorepo, infraestructura local,
dominio/persistencia, API y MCP autenticados, worker outbox y dashboard ejecutable.
El MVP completo sigue en construcción; hay entidades y flujos pendientes.
Consultar `docs/IMPLEMENTATION_STATUS.md` antes de asumir que un componente existe.

[README.md](README.md) es la entrada a la documentación del proyecto. Cuando se
cambien el propósito, los requisitos o el stack, documentarlos allí junto con los
pasos de instalación, ejecución y verificación que realmente existan.

Antes de una tarea, revisar los archivos relevantes y el estado de Git: rama,
cambios locales y operaciones pendientes. Respetar los cambios del usuario.
Las instrucciones explícitas del usuario y las reglas de la herramienta
prevalecen sobre esta guía.

## 2. Forma de trabajar

- Concretar el objetivo y cómo se comprobará antes de modificar archivos.
- Para tareas sencillas, hacer un cambio acotado y verificarlo sin exigir planes
  extensos. Para cambios amplios, aclarar requisitos y decisiones de arquitectura
  antes de implementar.
- Reutilizar lo que exista y evitar dependencias, abstracciones o documentos sin
  una necesidad concreta. No importar reglas o tecnologías de otros proyectos.
- Resolver decisiones reversibles con criterio y comunicar los supuestos.
  Consultar las dudas que afecten sustancialmente al alcance o al producto.
- Pedir autorización antes de lanzar subagentes, salvo que el usuario ya haya
  autorizado la delegación para el alcance de la tarea. Evitar ediciones
  simultáneas sobre los mismos archivos.

## 3. Implementación y verificación

- Seguir las convenciones del código y del stack cuando estén definidos.
- Corregir la causa de los fallos y reproducirlos cuando sea posible. No relajar
  comprobaciones para ocultar errores.
- Ejecutar las comprobaciones pertinentes al cambio y las exigidas por el
  proyecto: pruebas, análisis estático y build, según existan.
- En interfaces, revisar los tamaños y estados relevantes, así como la
  accesibilidad. La compilación por sí sola no acredita una revisión visual.
- En documentación, comprobar enlaces locales, coherencia y vigencia de las
  instrucciones. No inventar comandos ni suites que aún no existen.
- Informar qué se verificó, el resultado y cualquier limitación. No declarar
  terminada o publicada una tarea sin evidencia.

## 4. Git y publicación

No hay un flujo de ramas acordado todavía. No asumir que existen ramas de
desarrollo, entornos de producción o automatizaciones. Acordar el flujo cuando
sea necesario y documentarlo en esta guía.

Los nombres de ramas y mensajes de commit se escriben en inglés. Incluir solo
archivos relacionados con la tarea y revisar el diff antes de preparar un commit.
No reescribir el historial ni descartar cambios del usuario sin petición expresa.

Commit, push, merge y despliegue requieren autorización del usuario. Una petición
expresa ya cuenta como autorización para su alcance; no implica autorización
para las demás acciones.

## 5. Secretos y herramientas

No versionar ni mostrar credenciales, tokens o valores privados. Cuando se
necesite configuración por variables de entorno, documentar sus nombres con
ejemplos no sensibles y excluir los archivos de secretos del control de versiones.

Usar skills y herramientas disponibles cuando aporten al trabajo. No asumir que
hay plugins, servicios o skills locales instalados por aparecer en documentación
de otro proyecto. Adaptar los comandos al entorno de la sesión.

## 6. Documentación y comunicación

Duplicar todo el trabajo del proyecto en ACC mediante sus herramientas MCP:
desarrollo, correcciones, documentación, decisiones, pruebas, revisiones y
publicación. No limitar la copia a importar el backlog inicial. Los archivos
siguen siendo la referencia principal; ACC refleja alcance, avances, resultados,
evidencias, bloqueos y pendientes de cada trabajo, sin incluir secretos.

Antes de trabajar, consultar el proyecto y las tareas por MCP, reutilizar su
referencia estable o registrar la tarea que falte y abrir una sesión ACC. Cuando
el estado y los permisos lo permitan, reclamar antes de implementar, renovar
sesión/claim, registrar avances y evidencias, solicitar revisión y liberar o
finalizar la sesión. El agente con permisos de escritura puede recorrer todos los
estados, incluidos READY, QA, DONE, cancelación y reapertura, respetando transiciones,
versiones, claims, dependencias y evidencia técnica. No necesita aprobaciones
humanas previas. En DONE, una persona con permisos puede registrar Validar tarea:
es un OK de auditoría que no cambia estado ni revisión y no puede darlo el agente.

Al terminar cada bloque, actualizar archivos y su copia por MCP y comprobarla
mediante lectura y delta. Registrar IDs, resultados, commit/push si existen y
cualquier diferencia o sincronización pendiente. No afirmar sincronización
completa cuando falten datos o el contrato MCP no permita copiarlos. Aplicar
[el procedimiento de copia](docs/ACC_MIRROR.md). Importar o adjuntar no constituye
aceptación de evidencia ni aprobación humana.

Mantener la documentación proporcional al proyecto y actualizarla cuando cambien
el comportamiento, la configuración o las decisiones relevantes. Enlazar desde
el README los nuevos documentos que deban servir de referencia.

Comunicar en español, de forma breve y verificable: qué cambió, qué se comprobó
y qué queda pendiente. Distinguir el trabajo local de lo publicado y los supuestos
de las decisiones confirmadas.
