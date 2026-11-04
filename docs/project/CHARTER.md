# Acta resumida del proyecto existente

Resumen por referencia de la [especificación aceptada](../SPECIFICATION.md) y de
[Q1–Q40 con sustituciones](../DECISIONS.md); no es un acta vacía ni una aprobación nueva.

ACC coordina proyectos, humanos y agentes mediante estado verificable, API/MCP,
claims transaccionales y evidencias. No ejecuta modelos, no reemplaza Git ni guarda
prompts/secretos. Humanos supervisan; agentes actúan con identidad y permisos.

Primera entrega vertical publicada; MVP completo pendiente. Arquitectura existente:
monolito modular NestJS y SPA React/Vite, paquetes compartidos, PostgreSQL como
autoridad transaccional y Redis/outbox para distribución. No se modifica por esta
migración. [Mapa](../architecture/README.md), [estado](STATUS.md).

Restricciones: español, identidad propia ACC, validación humana posterior a DONE,
sin registro público, instalaciones/publicación bajo autorización, infraestructura
local que no acredita producción. SLO propuestos aún no medidos; entidades de
requisitos/decisiones/preguntas e impacto, proyectos generales y varios bloques
de integración/operación siguen pendientes. Los detalles viven en sus fuentes.
