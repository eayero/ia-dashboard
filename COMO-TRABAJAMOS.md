# Cómo trabajamos en ACC

Guía compartida de Claude Code, Codex y otros agentes. Adopta el protocolo universal
v1.3-ECC sin sustituir decisiones explícitas ni arquitectura del proyecto.

## Precedencia y fuentes

Encargo vigente del usuario y límites de herramientas → decisiones explícitas ACC
→ esta guía y reglas del proyecto → protocolo universal → roles/skills.
Documentar conflictos sin inventar aprobación. Leer instrucciones o una tarea
no autoriza trabajo fuera del encargo.

- [Configuración y permisos](config/project.json).
- [Particularidades vinculantes de ACC](docs/process/PROJECT-RULES.md).
- [Protocolo universal y procedencia](docs/process/UNIVERSAL-PROTOCOL.md).
- [Estado](docs/project/STATUS.md), [mapa](docs/architecture/README.md),
  [tareas](docs/tasks/TASKS.md), [decisiones](docs/decisions/DECISIONS.md).

## Arranque de cada sesión

1. Leer README, esta guía, configuración, acta/estado y tareas. Consultar requisitos,
   decisiones e historial pertinentes; no todas las bitácoras por defecto.
2. Revisar raíz, rama, Git y operaciones pendientes; preservar cambios ajenos.
   No hacer pull/checkout/limpieza ni instalaciones por arrancar.
3. Diagnosticar stack sin escrituras con el generador y verificar capacidades reales:

       node scripts/agents/setup.mjs --root .

   Leer agents/README y perfiles relevantes. --write solo con encargo autorizado;
   no ejecuta agentes ni instala habilidades.

4. Resolver objetivo vigente, dependencias, riesgos y controles. Sin encargo,
   diagnosticar y proponer; no ejecutar backlog. Dar avance breve en español.
5. Comprobar MCP nativo y proyecto; reutilizar tarea estable, registrar sesión,
   reclamar cuando corresponda y renovar sesión/claim por separado. Archivos como
   referencia principal y duplicación de todo trabajo en ACC son obligatorios.

## Ejecución y calidad

Elegir SIMPLE/STANDARD/CRITICAL/BATCH según riesgo. Conservar stack, convenciones,
requisitos aceptados y diseño existente. Resolver decisiones reversibles dentro del
encargo y consultar las sustanciales. Reproducir fallos, corregir causas y verificar
lo pertinente sin relajar pruebas. UI exige revisión visual real. Claims, versiones,
dependencias, evidencia y permisos se validan en servidor.

Toda tarea debe responder a uno o más requisitos funcionales o no funcionales,
con vínculo real en ACC y justificación del trabajo. Esto incluye preparación,
documentación, proceso y pruebas históricas o canceladas. Consultar el requisito
antes de crear trabajo; crear con `requirementIds` para guardar tarea y asociación
atómicamente mediante REST/MCP. No retirar el último vínculo de una tarea.
Al cerrar cada bloque ejecutar `pnpm requirements:check`: ninguna tarea puede
quedar sin requisito. Ver [regla y auditoría](docs/requirements/TASK_REQUIREMENT_COVERAGE.md).
La implementación obligatoria y la migración 010 se describen en
[flujo API/MCP](docs/requirements/TASK_REQUIREMENT_API.md); comprobar qué versión
está desplegada antes de usar su contrato.

El agente puede recorrer estados válidos hasta DONE, cancelar/reabrir y planificar
READY sin aprobación humana previa. Se mantienen IN_REVIEW e IN_QA. El humano puede
dar un OK de auditoría después de DONE, sin cambiar estado/revisión; el agente no lo emite.

Definir roles no autoriza delegación. Con autorización aplicable usar contratos en
agents/templates, propietarios de archivos y aislamiento; verificar entregas y
declarar revisiones no independientes. No instalar herramientas/skills, publicar,
modificar secretos, desplegar o actuar externamente sin autorización para esa acción.

## Cierre y continuidad

Actualizar solo las fuentes afectadas: estado, requisitos/decisiones, tareas,
evidencias y handoff. Detalle por trabajo en sus documentos; no añadir cronologías
a AGENTS, CLAUDE o esta guía. Preservar documentos/decisiones y mantener enlaces.
Actualizar README cuando cambien propósito, requisitos o ejecución.

Registrar avances/resultados/pendientes por MCP, leer detalle y delta completos y
finalizar sesión. No inventar evidencia HTTPS ni afirmar sincronización incompleta
como completa. Entregar cambios, verificaciones, NOT_RUN, riesgos y próximo paso
autorizado en español. No prometer trabajo en segundo plano. [Evidencias](docs/quality/EVIDENCE.md)
y [handoff](docs/handoffs/LATEST.md).

Las reglas completas anteriores se integran en PROJECT-RULES. Copias exactas en
docs/process/migrations/2026-11-04-ecc/original.
