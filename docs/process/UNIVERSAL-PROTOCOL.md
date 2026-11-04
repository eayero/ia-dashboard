# Cómo trabajamos — protocolo universal v1.1

## 0. Objetivo
Este protocolo sirve para proyectos nuevos, heredados y en curso. Es aplicable a Claude Code, Codex y otros agentes. **Leer estas instrucciones no autoriza crear infraestructura, instalar dependencias, ejecutar tareas del backlog, modificar código, lanzar subagentes, enviar mensajes, realizar commits, publicar ni gastar dinero.** El agente puede inspeccionar de forma no destructiva y preparar propuestas; para ejecutar trabajo debe existir una petición vigente o una autorización persistente explícita y acotada en `config/project.json`. Las instrucciones explícitas del usuario y las restricciones de las herramientas tienen prioridad.

## 1. Arranque de CADA sesión (obligatorio)
1. Leer este archivo, `config/project.json`, `docs/project/CHARTER.md`, `docs/project/STATUS.md`, `docs/tasks/TASKS.md` y `docs/decisions/DECISIONS.md` si existen.
2. Reconocer raíz del proyecto, repos asociados, rama, `git status`, operaciones en curso y archivos modificados. No hacer pull, checkout ni limpieza automática.
3. Detectar stack, scripts, pruebas y disponibilidad REAL de CLI, agentes, MCP, skills, red, Docker y CI. Registrar `disponible`, `ausente` o `no comprobado`. Leer `agents/README.md` e inventariar los roles definidos sin confundir definición con disponibilidad ejecutable.
4. Determinar estado: `NEW`, `DISCOVERY`, `DESIGN`, `IMPLEMENTING`, `VERIFYING`, `BLOCKED`, `MAINTENANCE` o `UNKNOWN`. No asumir que un repositorio vacío está listo para implementar.
5. Resolver el encargo vigente desde el mensaje del usuario; si no existe, no iniciar tareas: ofrecer el próximo paso recomendado y sus condiciones.
6. Detectar contradicciones entre documentos y código; preservar decisiones aceptadas, no inventarlas. Revisar dependencias y riesgos antes de proponer tareas.
7. Preparar un resumen breve: estado observado, objetivo, acción inmediata autorizada, dependencias, bloqueos y validación prevista.
8. Solo ejecutar las acciones comprendidas en el encargo o autorizaciones explícitas. Después actualizar fuentes de estado con evidencia.

## 2. Proyecto desde cero
Si no hay requisitos aceptados: hacer descubrimiento (problema, usuarios, valor, límites, requisitos funcionales y no funcionales, restricciones, amenazas, presupuesto, datos y operación). Crear borrador de `CHARTER.md`, requisitos y preguntas con recomendaciones y supuestos etiquetados. No dar por aceptada una propuesta por defecto.

Cuando exista alcance suficiente: investigar alternativas existentes, diseñar arquitectura proporcional, comparar opciones y registrar ADR; definir contratos, stack, repositorios, entornos, CI y pruebas. No crear repos ni contratar servicios sin autorización. Proponer MVP, roadmap e iteraciones verticales demostrables con criterios de aceptación. Aceptadas las puertas de producto y las autorizaciones técnicas, comenzar la primera iteración.

## 3. Proyecto existente
Inventariar repos, dependencias, arquitectura, componentes, despliegues, deuda, riesgos, estado real y evidencias. No sustituir documentación vigente por una plantilla vacía. Importar decisiones con referencia de origen; clasificar conflictos, pendientes y documentos obsoletos. Recomendar un plan de adopción incremental sin interrumpir trabajo vigente.

## 4. Modos de ejecución
- **SIMPLE:** cambios pequeños de bajo riesgo: contexto → cambio acotado → pruebas pertinentes → registro.
- **STANDARD:** funcionalidad normal: requisitos → investigación proporcionada → diseño si procede → tareas → implementación → revisión → pruebas → entrega.
- **CRITICAL:** pagos, identidad, seguridad, datos sensibles, concurrencia, migraciones, normativa o acciones irreversibles: análisis y amenazas explícitos → aprobación de puertas → implementación controlada → revisión independiente cuando sea viable → integración real → pruebas de fallos y recuperación → evidencia de cierre.
- **BATCH:** conjunto de tareas ya especificadas y sin decisiones bloqueantes; ejecutar en tandas con verificación intermedia y final, sin publicar con gates fallidos.
El modo se determina por riesgo y configuración, no solo por tamaño. La complejidad documental debe ser proporcional.

## 5. Ciclo de una tarea
Cada tarea tiene ID estable, origen, prioridad, estado, dueño, repos, dependencias, alcance de archivos, criterios de aceptación, pruebas exigidas y evidencia. Estados: `BACKLOG`, `READY`, `IN_PROGRESS`, `REVIEW`, `BLOCKED`, `DONE`, `CANCELLED`. `DONE` requiere evidencia y actualización del estado. Las decisiones son `PROPOSED`, `ACCEPTED`, `REJECTED` o `SUPERSEDED`; nunca convertir supuestos en decisiones. ID de tarea o decisión: asignar bajo bloqueo del registro compartido si hay varios agentes; si no existe bloqueo central, serializar alta en un solo coordinador y detectar colisiones.

## 6. Diseño y arquitectura
Antes de nueva interfaz, proponer hasta tres alternativas comparables cuando exista una elección de UX sustancial; incluir estados, móvil/escritorio o tamaños nativos, claro/oscuro si aplica y accesibilidad. Una reparación menor no exige tres diseños. Aplicar la identidad y skills del proyecto si existen; no trasladar branding de otro producto.
Antes de introducir una librería o desarrollar desde cero, comparar capacidades nativas, OSS, servicios, licencia, mantenimiento, seguridad, coste y disponibilidad operativa. Elegir simplicidad proporcional: SOLID, DRY, KISS, YAGNI y límites claros, sin arquitectura ceremonial.

## 7. Multiagente y concurrencia
El coordinador de la sesión es el punto de comunicación. Puede distribuir análisis, diseño, implementación, QA y seguridad únicamente con herramientas existentes y autorización aplicable. Los contratos de rol están en `agents/roles/` y la delegación y el retorno siguen `agents/templates/`. Contrato de delegación: `TASK_ID | Objective | Inputs | Constraints | Repository/Branch | Owned files | Acceptance | Return evidence`. Un escritor por checkout; worktrees aislados para paralelo; prohibido editar archivos ajenos sin coordinación. Los informes de subagentes son hipótesis hasta verificarse. No afirmar coordinación automática entre sesiones sin un almacenamiento/servicio compartido real. Si existe ACC, usarlo como registro de tareas y bloqueos, manteniendo Markdown como respaldo; comprobar conexión antes de afirmar sincronización.

## 8. Quality gates
Por cambio: checks rápidos pertinentes; por entrega: suite completa aplicable, build, lint/typecheck, integración representativa y contratos; para interfaz: revisión visual y accesibilidad; para riesgo: seguridad, concurrencia, integridad, recuperación y rendimiento según alcance. No desactivar pruebas para lograr verde. Registrar comandos, resultado, entorno, commit y limitaciones en `docs/quality/EVIDENCE.md`. Si no se ejecuta una prueba, marcar `NOT_RUN`, nunca `PASS`. No publicar con gates requeridos fallidos.

## 9. Git, secretos y efectos externos
No realizar commit, push, merge, despliegue, reset, borrado, cambios de secretos, instalaciones ni acciones externas sin autorización que cubra esa acción. Preservar cambios de otros agentes; `git status` antes y después. La política de ramas es configurable; no asumir `main`/`dev`. Nunca colocar secretos en archivos versionados, logs, prompts ni reportes. Ejecutar comandos con entorno mínimo adecuado. Producción y datos reales requieren aprobación específica; los entornos de prueba deben identificarse claramente. Desplegar solo desde revisión verificable y comprobar resultado y posibilidad de recuperación.

## 10. Documentación sostenible
`AGENTS.md`, `CLAUDE.md` y este protocolo son cortos y estables. No registrar bitácoras diarias aquí. Estado actual en `docs/project/STATUS.md`, tareas en `docs/tasks/TASKS.md`, decisiones en `docs/decisions/DECISIONS.md`, evidencias en `docs/quality/EVIDENCE.md`, transferencia de sesión en `docs/handoffs/LATEST.md`; especificaciones y ADR en sus carpetas. Actualizar solo lo que cambia. Archivar entradas antiguas sin eliminar decisiones vigentes. Nunca mantener índices manuales gigantes por documento: índices por carpeta y enlaces desde el estado.

## 11. Cierre y comunicación
Entregar en español (salvo configuración distinta): qué se cambió, qué se verificó, qué no se verificó, qué está bloqueado y siguiente paso. Antes de cerrar, actualizar tareas, decisiones y estado; registrar evidencia real. `DONE` no equivale a desplegado. No continuar trabajo en segundo plano ni prometer ejecución futura sin un servicio de automatización real.


## 12. Creación, activación y mantenimiento de agentes especializados

**Regla central:** cada proyecto define un *equipo lógico* de agentes con roles especializados. Durante el arranque el coordinador lee `config/project.json` y `agents/roles/`, identifica las capacidades realmente instaladas y decide qué roles necesita cada encargo. **Definir un rol no significa que el sistema haya lanzado un agente**: la ejecución requiere herramienta compatible, disponibilidad de recursos y autorización aplicable. Si no se pueden lanzar subagentes, el coordinador aplica las mismas fases secuencialmente y declara qué revisiones no fueron independientes.

### 12.1 Equipo mínimo y cuándo intervenir

| Rol | Identificador | Activación típica | Salida / puerta |
| --- | --- | --- | --- |
| Coordinación | `coordinator` | Todo encargo | Diagnóstico, asignaciones, integración y estado |
| Levantamiento de requisitos | `requirements-analyst` | Proyecto nuevo, funcionalidad ambigua o cambio de alcance | Requisitos, escenarios y preguntas; aceptación de producto |
| Diseño UX/UI | `ux-designer` | Nueva experiencia o cambios sustanciales de navegación/interfaz | Flujos, alternativas y prototipo; elección de producto |
| Evaluación de diseños | `design-reviewer` | Antes de aprobar interfaz y en revisión de UI implementada | Hallazgos, consistencia y dictamen UX |
| Desarrollo | `developer` | Tareas `READY` con dependencias satisfechas | Código, pruebas unitarias y manifiesto de cambios |
| QA | `qa-engineer` | Planificación de pruebas y verificación tras implementación | Regresión, aceptación, defectos y dictamen QA |
| Arquitectura | `architect` | Decisiones técnicas sustanciales | ADR y contratos revisables |
| Seguridad | `security-reviewer` | Riesgo alto o crítico | Hallazgos y puerta de seguridad |

Para tareas pequeñas, la coordinación puede fusionar temporalmente funciones **sin fingir independencia**. Para cambios críticos, quien implementa no debe ser el único que certifica calidad o seguridad. Preferir roles reutilizables frente a crear un agente nuevo por cada historia de usuario.

### 12.2 Cuándo crear un agente nuevo

Crear una definición en `agents/roles/<slug>.md` solo cuando exista una responsabilidad recurrente, con entradas, resultados, límites y criterios distintos de los roles disponibles. El coordinador debe primero comprobar si se resuelve mediante un rol existente + una skill especializada. Proponer el nuevo rol, su costo de coordinación, interoperabilidad y pruebas; no crear nuevos agentes ejecutables ni iniciar delegaciones sin autorización correspondiente.

Cada rol nuevo debe definir: misión; condiciones de activación; fuentes y skills exigidas; restricciones operativas; entradas; resultados verificables; criterios para escalar o bloquear; formato de retorno; responsabilidad sobre archivos; y qué no puede aprobar por sí solo. Registrar la definición en `agents/README.md` y, si se admite su instalación, crear un adaptador mínimo para el runtime real (Claude, Codex u otro), evitando copiar el protocolo. Probar primero una delegación pequeña y revisar la calidad del resultado antes de declararlo disponible.

### 12.3 Flujos obligatorios entre roles

**Proyecto desde cero:** `coordinator → requirements-analyst → (architect y ux-designer según dominio) → design-reviewer (si hay UI) → aprobación de requisitos/diseño → planificación de iteración → developer → qa-engineer → revisión de seguridad si aplica → coordinator (gate y cierre)`. El levantamiento puede producir borradores antes de tener todas las respuestas; la implementación requiere requisitos suficientemente aceptados, salvo un prototipo expresamente autorizado.

**Nueva funcionalidad:** requisitos/impacto → diseño o contrato → revisión de diseño si aplica → tareas `READY` → desarrollo → QA → cierre. No introducir automáticamente tres propuestas cuando hay un patrón de diseño ya aprobado y el cambio no introduce una decisión UX sustancial.

**Corrección de bug:** coordinación/QA reproduce → desarrollador corrige causa raíz y añade regresión → QA verifica → coordinación cierra. Si el fallo deriva de reglas de producto ambiguas, enviar a requisitos antes de editar.

**Auditoría UX/UI:** diseñador no valida en solitario sus propuestas. `design-reviewer` inspecciona flujos, consistencia, accesibilidad, comportamiento móvil/escritorio, estados y evidencias; devuelve `ACCEPT`, `REVISE` o `BLOCK`. El diseñador responde con cambios o justificaciones; producto decide sobre preferencias de diseño, mientras que los criterios críticos de accesibilidad y seguridad no se omiten sin registrar riesgo y autorización adecuada.

**Mantenimiento de una aplicación existente:** inventario y comparación con decisiones → diagnóstico QA/diseño → plan de mejoras priorizadas → desarrollo por bloques → regresión y validación; evitar rediseñar toda la app sin necesidad.

### 12.4 Contrato de delegación y entrega

Antes de lanzar un agente, asignar `TASK_ID`, objetivo, rol, requisitos, artefactos de entrada, repositorio, rama/worktree, **archivos en propiedad exclusiva**, dependencias, skills disponibles, criterios observables, verificaciones y límites de autorización mediante `agents/templates/TASK-DELEGATION.md`. Toda respuesta seguirá `agents/templates/RESULT.md`. El coordinador valida que las evidencias correspondan al commit y entorno de la tarea, y registra hallazgos y preguntas; nunca convierte el informe de un subagente en un `PASS` global sin comprobar las puertas.

### 12.5 Separación de responsabilidades y concurrencia

- `requirements-analyst` define *qué y por qué*; `architect` define opciones técnicas; `ux-designer` define *cómo interactúa*; `design-reviewer` evalúa alternativas; `developer` implementa; `qa-engineer` verifica el comportamiento real. No imponer decisiones de diseño desde implementación sin volver al responsable.
- El diseño y la arquitectura pueden investigar en paralelo cuando sus fronteras estén claras. Desarrollo en paralelo solo con worktrees/repositorios aislados y propietarios no solapados; tareas con contratos compartidos requieren coordinación previa.
- QA puede redactar pruebas antes del desarrollo, pero la aceptación final se realiza sobre el artefacto implementado. Las discrepancias se devuelven como defectos o decisiones pendientes, no se cambian silenciosamente las expectativas.
- El estado y la numeración se registran en la fuente compartida configurada. Con Markdown, un coordinador asigna IDs en serie. ACC, si está conectado y comprobado, puede suministrar locks y estados; su ausencia impide afirmar exclusión distribuida.

### 12.6 Selección de skills y evaluación del desempeño de agentes

El coordinador detecta skills por stack y encargo: ingeniería limpia para desarrollo/arquitectura; modelado de dominio en requisitos; UX/design system y accesibilidad en diseño; auditoría de interfaz para evaluación; pruebas e2e y QA móvil/web para QA; seguridad para cambios críticos. Usar únicamente skills realmente disponibles; registrar sustitutos o ausencia, sin fingir que se ejecutaron. No cargar catálogos completos indiscriminadamente.

Tras cada entrega, evaluar a los roles por cobertura de criterios, defectos escapados, retrabajo, verificaciones, claridad de entrega y cumplimiento de límites. Las métricas se refieren a evidencias, no a cantidades de texto o código. Los hallazgos recurrentes se incorporan a las definiciones o skills; las decisiones del proyecto se quedan en su registro, no en la instrucción universal.

### 12.7 Gobierno y autonomía

Los roles pueden analizar, producir propuestas, hacer revisión de lectura y efectuar acciones cubiertas por el encargo. Su creación **no amplía permisos** sobre instalación, Git, despliegues, datos reales, costes, usuarios externos ni decisiones de producto. Ante una decisión bloqueante, el coordinador formula una pregunta concreta con recomendación; los supuestos reversibles deben identificarse y no se convierten en acuerdos. No dejar agentes ejecutándose indefinidamente ni prometer ejecución en segundo plano sin infraestructura operativa explícita.

## 13. Detección de stack y generación contextual de agentes (v1.2)

**Arranque:** consultar `config/project.json` y ejecutar `node scripts/agents/setup.mjs --root .` para un inventario *sin escrituras*. Cuando el encargo autorice preparar el entorno del proyecto, ejecutar `node scripts/agents/setup.mjs --root . --write` y revisar los resultados. Esto prepara archivos de instrucciones, **no lanza procesos, agentes, instalaciones ni delegaciones**. Ningún entorno garantiza ejecutar comandos automáticamente solo por abrir una carpeta; las entradas `AGENTS.md` y `CLAUDE.md` solicitan expresamente ese arranque cuando hay acceso a terminal.

El detector examina manifiestos comunes (`pom.xml`, `build.gradle[.kts]`, `build.sbt`, `package.json`, `Package.swift`, `project.yml`, `pyproject.toml`, `requirements.txt`) sin recorrer directorios de dependencias, builds ni enlaces simbólicos. Reconoce perfiles Java/Spring, Node/NestJS, Node general, Scala/Akka, Android/Kotlin, iOS/Swift, React/web y Python. En proyectos multitecnología combina perfiles; `config/project.json > agents.specialization.profiles` permite declarar los no detectables. **La detección es heurística:** un perfil propuesto no acredita que el código realmente emplee todos los patrones ni que se hayan ejecutado verificaciones.

La matriz canónica de tecnologías, recomendaciones y skills se encuentra en `agents/profiles/catalog.json`. El generador produce `agents/generated/<rol>.md` (contrato de rol + normas del stack + inventario real de skills disponibles) y adaptadores mínimos en `.claude/agents/<rol>.md`. Para Codex, `AGENTS.md` indica consultar `agents/generated/`; no se presupone soporte nativo de subagentes o un formato de registro específico de Codex. Un adaptador no concede permisos nuevos.

**Disponibilidad de skills:** se comprueba la existencia de `SKILL.md` en rutas del proyecto y, opcionalmente, en el directorio habitual de Claude del usuario. Las skills ausentes se marcan `NO ENCONTRADA`; no se descargan, copian ni instalan. El agente solo lee y aplica skills relevantes cuando la tarea lo requiere. Un archivo generado no certifica que la skill se haya utilizado.

**Idempotencia y seguridad:** sin `--write`, el comando es de solo lectura. Con `--write`, nunca modifica archivos previos. `--force` regenera únicamente archivos con marca de generación válida, sin sobrescribir entradas personalizadas; tampoco edita `AGENTS.md`, `CLAUDE.md`, código de aplicación, Git o secretos. Los resultados se registran en `agents/generated/DETECTION.json` cuando se escribe. Antes de emplear los adaptadores, comprobar su compatibilidad con la versión instalada del runtime y ejecutar `node --test tests/agents-setup.test.mjs`.

**Selección por encargo:** el coordinador usa la matriz de roles y el stack detectado, pero activa únicamente los roles necesarios para la tarea. Requisitos y arquitectura no se sustituyen por generación de agentes. Para múltiples repositorios, indicar el área de responsabilidad concreta en cada delegación. Integración con ACC permanece opcional y requiere un conector real antes de usar estados o locks distribuidos.


## 14. Skills alineadas con ECC (v1.3)

La base de habilidades por stack procede del proyecto público [Everything Claude Code (ECC)](https://github.com/affaan-m/ECC), y se configura en `agents/profiles/catalog.json`. La referencia concreta de asignaciones por tecnologías es [`skills/prompt-optimizer/SKILL.md`](https://github.com/affaan-m/ECC/blob/main/skills/prompt-optimizer/SKILL.md). No se presupone que una skill esté instalada ni que su nombre exista en todas las revisiones de ECC: **la disponibilidad se comprueba mediante su `SKILL.md` en el proyecto o instalación local**.

**Principio de reutilización:** usar primero capacidades ECC (estándares, TDD, patrones, seguridad, API, E2E y verificación) y crear habilidades propias únicamente para requisitos diferenciales. El catálogo distingue `eccReference`, `eccCandidateVerify` y `custom`. Las extensiones `clean-code-engineering`, `ui-craft`, `mobile-product-qa-auditor` y `scala-akka-engineering` no deben presentarse como originales de ECC.

**Roles y elección:** el `developer` combina las habilidades ECC del stack con TDD; `qa-engineer` incorpora TDD, E2E y verificación; `security-reviewer` aplica `security-review`; `architect` consulta diseño de APIs y patrones backend; los agentes UX usan patrones de interfaz, revisión visual, accesibilidad y `ui-craft` cuando exista. Las habilidades no sustituyen los contratos de delegación ni la revisión independiente.

**Proyectos mixtos:** seleccionar solo las skills pertinentes para el módulo de la tarea. Si se detectan Java, Android, Scala y React, no cargar todas las skills en cada agente. La detección del repositorio genera candidatos; el coordinador debe limitar el stack a los archivos y responsabilidades del encargo antes de iniciar una delegación.

**Instalación:** no instalar ECC ni copiar sus archivos automáticamente. Revisar la versión, procedencia, licencia, hooks, permisos y alcance antes de incorporarlo. No duplicar una instalación por plugin con una copia local sin necesidad. En ausencia de ECC, las reglas base de `COMO-TRABAJAMOS.md` siguen vigentes y el agente informa qué capacidades no pudo aplicar.
