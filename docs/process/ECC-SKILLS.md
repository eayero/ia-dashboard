# Skills ECC comprobadas

Inventario local ECC 2.2.3: 311 SKILL.md presentes y 22
seleccionados por stack/rol; 0 seleccionados ausentes.
[Inventario con hashes](ECC-INVENTORY.json), [catálogo](../../agents/profiles/catalog.json)
y [detección por rol](../../agents/generated/DETECTION.json). No se copió código
ECC, no se instaló una skill ni se ejecutaron hooks.

| Skill                     | Archivo        | Procedencia encontrada |
| ------------------------- | -------------- | ---------------------- |
| accessibility             | AVAILABLE_FILE | ECC-plugin-cache       |
| api-design                | AVAILABLE_FILE | ECC-plugin-cache       |
| backend-patterns          | AVAILABLE_FILE | ECC-plugin-cache       |
| coding-standards          | AVAILABLE_FILE | ECC-plugin-cache       |
| database-migrations       | AVAILABLE_FILE | ECC-plugin-cache       |
| design-system             | AVAILABLE_FILE | ECC-plugin-cache       |
| docker-patterns           | AVAILABLE_FILE | ECC-plugin-cache       |
| docs-governance           | AVAILABLE_FILE | ECC-plugin-cache       |
| e2e-testing               | AVAILABLE_FILE | ECC-plugin-cache       |
| frontend-a11y             | AVAILABLE_FILE | ECC-plugin-cache       |
| frontend-design-direction | AVAILABLE_FILE | ECC-plugin-cache       |
| frontend-patterns         | AVAILABLE_FILE | ECC-plugin-cache       |
| living-docs-governance    | AVAILABLE_FILE | ECC-plugin-cache       |
| mcp-server-patterns       | AVAILABLE_FILE | ECC-plugin-cache       |
| nestjs-patterns           | AVAILABLE_FILE | ECC-plugin-cache       |
| postgres-patterns         | AVAILABLE_FILE | ECC-plugin-cache       |
| prisma-patterns           | AVAILABLE_FILE | ECC-plugin-cache       |
| react-patterns            | AVAILABLE_FILE | ECC-plugin-cache       |
| react-testing             | AVAILABLE_FILE | ECC-plugin-cache       |
| security-review           | AVAILABLE_FILE | ECC-plugin-cache       |
| tdd-workflow              | AVAILABLE_FILE | ECC-plugin-cache       |
| verification-loop         | AVAILABLE_FILE | ECC-plugin-cache       |

Para cada encargo seleccionar solo el subconjunto pertinente y leer su SKILL.md.
Se aplicaron docs-governance y living-docs-governance a esta adopción. Presencia
no demuestra ejecución. La sesión Codex expone las skills seleccionadas; su registro
en Claude no se certifica por leer la caché de Codex.

No se instalaron ui-craft, clean-code-engineering, mobile-product-qa-auditor ni
scala-akka-engineering. Las dos primeras no son requeridas: las capacidades
relevantes se cubren con skills ECC existentes, sin afirmar equivalencia exacta;
QA móvil y Scala no corresponden al stack actual. Son extensiones, no ECC oficial.

El generador original no cubría la caché de plugins y su informe de ausencias era
incorrecto. La adaptación usa raíces configurables, rutas portables, inventario
directo y protección de salidas gestionadas. Instalación o actualización futura
requiere comprobar disponibilidad, procedencia, permisos y autorización.
