# Informe de adopción local ECC

La migración local quedó implementada y verificada el 2026-11-04. El diagnóstico
y el plan precedieron a los cambios de instrucciones. No se modificó el producto,
su arquitectura ni sus decisiones aceptadas; no hubo instalaciones, ejecución de
agentes, commits, pushes, merges ni despliegues.

## Cambios y conservación

- Se leyeron los 29 archivos de la plantilla. Su manifiesto SHA-256 y una copia
  exacta del protocolo universal conservan la procedencia. El título interno v1.1
  de la distribución v1.3-ECC se documentó, sin corregir el original.
- AGENTS y CLAUDE remiten a una guía compartida breve. PROJECT-RULES integra las
  particularidades anteriores; las tres instrucciones originales se archivaron
  byte por byte. No se borró documentación ni se reemplazaron decisiones.
- Se añadieron configuración, mapa documental, índices de estado, arquitectura,
  requisitos, decisiones, tareas, evidencias y handoff. Las fuentes históricas
  permanecen en sus rutas. TRACEABILITY relaciona 20 requisitos existentes y el
  trabajo de adopción con decisiones, tareas y evidencias, incluyendo pendientes.
- El generador local excluye herramientas internas, descubre la caché ECC,
  calcula ausencias directamente y protege personalizaciones, rutas y junctions.
  Su modo de comprobación detecta deriva sin escribir. La plantilla externa no cambia.
- Las únicas fuentes originales editadas son README, AGENTS, CLAUDE, COMO-TRABAJAMOS,
  .prettierignore, el catálogo de tareas y el snapshot MCP. Los restantes 148 de los
  155 archivos base conservan sus hashes. Los 18 alcances previos de tareas se conservan.

## Equipo y skills

Se generaron ocho perfiles: coordinación, requisitos, arquitectura, diseño UX,
evaluación de diseños, desarrollo, QA y seguridad. Hay siete adaptadores Claude;
la coordinación corresponde a la sesión principal. Codex sigue AGENTS y consulta
los perfiles canónicos. Estas definiciones no crean usuarios, agentes ni tokens ACC.

Stack detectado: Node/TypeScript, NestJS, React/Vite, PostgreSQL, Redis/eventos,
servidor MCP y Docker. Se verificaron 311 archivos SKILL.md en ECC 2.2.3 y se
seleccionaron 22 disponibles; ninguna skill seleccionada falta. El
[inventario](../../ECC-SKILLS.md) identifica nombres y rutas. No se instalaron ni
copiaron skills. Disponibilidad de archivos no implica registro ni ejecución por
un harness. Para esta migración se aplicaron docs-governance y living-docs-governance.

## Conflictos resueltos a favor de ACC

Se conserva MCP obligatorio y archivos como referencia principal, estados
IN_REVIEW/IN_QA, autonomía del agente para transiciones válidas y validación humana
posterior a DONE. Se mantiene propiedad humana de agentes y acceso a varios
proyectos. Las reglas generales de la plantilla no autorizan delegación automática,
instalaciones, cambio de stack, otra política de ramas ni reutilización de permisos
de publicación anteriores. Las propuestas históricas sustituidas quedan accesibles
y señaladas desde los índices actuales.

## Verificación, pendientes y riesgos

Las 16 pruebas nuevas pasan: generación segura e idempotente, detección de stack,
skills faltantes, protección de personalizaciones, enlaces, trazabilidad, autoridad
compartida y adaptadores. ESLint del tooling pasa; el resultado estructurado registra
la comprobación final de formato, hashes y Git.

La continuidad Claude/Codex se validó estáticamente: entradas, referencias,
metadatos y permisos. No se ejecutaron modelos, sesiones nuevas ni agentes reales;
esa prueba operativa queda pendiente. Claude CLI 2.1.317 y Node 24.20.0 están
disponibles; Codex CLI no está en PATH. El auditor Python ECC quedó NOT_RUN porque
Python no fue detectado. No se repitieron suites/build del producto: sus resultados
anteriores están identificados como históricos.

ACC-LOCAL-019/TASK-25 registra diagnóstico y resultado por MCP. Su estado permanece
IN_PROGRESS: falta evidencia formal HTTPS publicable, pues el encargo prohíbe
publicar. No se inventa evidencia ni validación humana. El detalle final de sesión,
claim y conciliación figura en [RESULT.json](RESULT.json) y el snapshot ACC.

Riesgos residuales: rutas de skills dependen del entorno local; una actualización
de ECC requiere redetección y revisión de perfiles; la prueba estática no acredita
carga efectiva en una sesión nueva. El verificador de hashes es una auditoría de
esta adopción, no un bloqueo permanente a futuros cambios autorizados del producto.
