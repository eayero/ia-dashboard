# Revisión humana para cerrar entregas pendientes

Preparada el 2026-11-05 mediante lectura MCP nativa y contexto completo. No
constituye aprobación, evaluación de impacto ni OK humano posterior a DONE.

## Orden propuesto

Primero REQ-23 para TASK-16; después REQ-19 para TASK-26. Hay 23 requisitos DRAFT
y 42 vínculos en el proyecto. Esta revisión no propone aprobarlos en bloque.
El agente no utiliza credenciales humanas para emitir estas decisiones.

## REQ-23 / NFR-003 — trazabilidad

ID `1954586e-6b6c-4e49-8993-f1657aa575ea`, revisión 1, versión observada 4.
Exige asociar todas las tareas a requisitos, conservar origen/decisiones/evidencia
y duplicar seguimiento por MCP sin inventar aprobaciones. Su texto completo se
consulta en el catálogo de requisitos de http://localhost:55173.

Entrega publicada: `94d7a34584b84ff9a42ce062243adb1a21f89f01`, migración 010.
[Resultado](TASK_REQUIREMENT_API_RESULT.json),
[despliegue](TASK_REQUIREMENT_DEPLOYMENT.json) y
[cobertura](TASK_REQUIREMENT_COVERAGE.json). La auditoría de esta sesión volvió
a confirmar 28 tareas cubiertas, 23 requisitos y cero huérfanas.

Tareas vinculadas: TASK-16 IN_PROGRESS, TASK-25 DONE y TASK-2 BACKLOG.
Aprobar el requisito marcará impacto y aumentará versiones de las tareas; para
TASK-25 generará una alerta, sin reabrirla automáticamente. Evaluar cada vínculo
según su alcance; no presentar la aprobación como implementación de TASK-2.

Motivo propuesto para la revisión de TASK-16, sujeto a criterio humano:
«La revisión 1 exige trazabilidad y requisitos obligatorios. La entrega publicada
94d7a34 y el despliegue con migración 010 cubren ese alcance; la auditoría confirma
cobertura completa. No se exige modificar criterios históricos ni emitir OK
humano sobre tareas DONE para esta evaluación.»

## REQ-19 / FR-019 — métricas y tiempo

ID `e94f7129-0242-48af-883a-d7faac907653`, revisión 1, versión observada 2.
Alcance completo: throughput, ciclo, bloqueos, reabiertas, tiempo y coste opcional.
TASK-26 cubre **solo tiempo explícito por tarea, agente y día**, según sus cuatro
criterios y el [diseño aprobado](TASK_WORK_TIME_DESIGN.md).

Entrega publicada: `02e232f8570139cd57bd2c6271e1d1f70efb7af0`, migración 009.
[Resultado](TASK_WORK_TIME_RESULT.json) y
[despliegue](TASK_WORK_TIME_DEPLOYMENT.json). El informe acredita 66 unitarias,
112 integraciones y 16 de protocolo en ese momento; no son pruebas reejecutadas
en esta sesión. La posterior entrega 94d7a34 conserva esa funcionalidad.

Única tarea vinculada: TASK-26 IN_PROGRESS. Aprobar y evaluar este vínculo no
declara implementadas las restantes métricas de FR-019.

Motivo propuesto, sujeto a criterio humano:
«El alcance de TASK-26 se limita al registro explícito y desglose de tiempo
aprobados en su diseño; sus criterios no exigen las demás métricas de FR-019.
La entrega 02e232f cubre ese subconjunto. Las demás métricas permanecen pendientes
en el MVP; esta evaluación no las da por terminadas.»

Además del impacto, TASK-26 requiere registro de repositorio y evidencia CODE/TEST
pareada en su revisión de trabajo vigente. La evidencia OTHER actual no los
sustituye. Ver [diseño de catálogo](REPOSITORY_REGISTRY_DESIGN.md).

## Acción humana y versiones

En la UI, abrir Requisitos, leer cada propuesta completa y aprobar la revisión
solo si se acepta su alcance. Después revisar los vínculos y registrar el motivo
de impacto por tarea. Los endpoints son `approve` y `evaluate-impact`; requieren
humano OWNER/ADMIN/MANAGER y versiones actuales. Consultar de nuevo requisito y
tarea tras cada acción: no reutilizar las versiones observadas en este documento.

Tras esas decisiones, el agente puede continuar revisión, QA y DONE con evidencias
vigentes. El OK humano posterior a DONE sigue siendo otra acción separada.
