# Diagnóstico previo a la adopción ECC

Fecha: 2026-11-04. Encargo: migración local no destructiva del protocolo, no del
producto. Base Git `edaf57d19e8f9c7ed83d9a63ba2ad6ad6b0134f4`, rama
`feat/acc-foundation`, árbol inicialmente limpio. Este diagnóstico y el plan se
registran antes de cambiar instrucciones o generar perfiles.

## Plantilla leída

Leídos íntegramente protocolo, entradas Codex/Claude, README, configuración,
catálogo, ocho roles, dos contratos de intercambio, documentos iniciales, generador,
sus pruebas y la skill Scala/Akka. El manifiesto SHA-256 identifica cada archivo;
el código de la plantilla externa no se modifica.

La distribución dice v1.3-ECC, pero el título del protocolo sigue en v1.1 y sus
secciones de generación/ECC indican v1.2/v1.3. Se conserva esa procedencia sin
presentar el título como una versión nueva del producto.

## Proyecto observado

- Monorepo pnpm 12.16.1/Turbo; Node >=22.18, TypeScript estricto, ESM.
- API NestJS 12/Express 5; Zod 4; MCP SDK 1.32.2; Socket.IO 4; OpenAPI 3.1.1.
- SPA React 19/Vite 8/TanStack Router y Query, CSS propio y dependencias Tailwind.
- PostgreSQL 17 con SQL transaccional, siete migraciones aplicadas, Prisma como
  dependencia; Redis 7.4/outbox; Docker Compose/Nginx. No se infiere que todos los
  componentes propuestos en la especificación estén implementados.
- Requisitos FR-001…020 en SPECIFICATION; Q1…40 y sustituciones en DECISIONS;
  ADR-0001 y diseño visual aprobado conservados. El MCP está dentro de apps/api,
  no en un servicio apps/mcp separado. No crear los paquetes proyectados ausentes.
- Fuentes: README, guía compartida y entradas cortas; estado histórico de 400+
  líneas; runbooks y resultados JSON. Hay notas históricas que aún dicen OIDC,
  gates humanos, OpenAPI/WS pendientes. Las sustituciones y PUBLICATION_RESULT
  aclaran el estado; esas notas no deben usarse como instrucciones actuales.
- ACC nativo comprobado: proyecto 3268b4d2-cd9d-4afc-bc76-ea631997cd73, 24 tareas
  previas y 18 referencias de catálogo; seis cierres publicados. Nueva referencia
  de migración ACC-LOCAL-019 / TASK-25. No modificar estados/criterios ajenos.
- No había agentes, configuración o skills propios en agents/, config/,
  .claude/, .agents/ o .codex/ del proyecto.
- Node 24.20 y Claude Code 2.1.317 comprobados; Codex es el runtime de esta sesión,
  su CLI no aparece en PATH. pnpm existe en .tools, no en PATH. Git y CLI Docker
  detectados; no se arrancó ni desplegó infraestructura. Python no detectado.
- Caché ECC 2.2.3 presente con 311 directorios candidatos. Debe comprobarse cada
  SKILL.md; presencia de archivos no demuestra registro en Claude ni ejecución.

## Reglas conservadas y conflictos

| Tema                                                 | Resolución de esta migración                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ACC opcional en plantilla / obligatorio aquí         | Conservar duplicación MCP de todo trabajo; archivos como referencia principal; ACC coordina sesiones/claims reales.             |
| REVIEW genérico / estados del producto               | Mantener BACKLOG, READY, IN_PROGRESS, BLOCKED, IN_REVIEW, IN_QA, DONE, CANCELLED.                                               |
| Puertas de aprobación genéricas / autonomía aprobada | No reinstalar aprobaciones humanas previas de estados. Conservar gates técnicos; OK humano solo posterior a DONE.               |
| Gestión de agentes                                   | Mantener usuario propietario, permisos efectivos y proyectos múltiples; perfiles de ingeniería no crean identidades ACC.        |
| Git/instalaciones                                    | El encargo actual prohíbe commit/push/merge/despliegue e instalaciones. La autorización de publicación anterior está consumida. |
| Subagentes                                           | Generar definiciones no autoriza ejecutarlas; se mantiene consentimiento aplicable, sin delegación automática.                  |
| Fuentes de producto                                  | No copiar placeholders NEW, acta vacía, D-0001 ni T-0001 sobre requisitos/decisiones existentes.                                |
| Instrucciones repetidas                              | Mantener entradas cortas y una guía compartida; detalle universal, reglas ACC y evidencia por separado.                         |
| Skills de otros stacks                               | No copiar/instalar la extensión Scala/Akka ni exigir QA móvil, ui-craft o clean-code-engineering a este proyecto web.           |

## Límites encontrados en el generador de origen

La prueba de solo lectura encontró NestJS/React/Node, pero incluyó
`.tools/package.json`. La búsqueda de skills omite la caché ECC de Codex. El
cálculo skillsMissing usa un path con barras y un regex que no coincide con el
Markdown emitido: reporta lista vacía pese a habilidades no encontradas. El informe
DETECTION no tiene protección de propiedad equivalente a la de adaptadores.

La adaptación local excluirá herramientas auxiliares, descubrirá perfiles DB/MCP/
infraestructura desde manifiestos, resolverá skills en ubicaciones configuradas,
registrará ausencias directamente y protegerá todos los archivos personalizados,
incluido DETECTION. Añadirá pruebas de solo lectura, idempotencia y contención.

## Estrategia documental

Conservar íntegros especificación, decisiones, ADR, informes y estados históricos.
Los nuevos documentos de entrada serán índices o resúmenes delimitados, con una
fuente por hecho. Archivar copia exacta de las tres instrucciones anteriores antes
de integrarlas. La arquitectura y el código funcional se comprueban por hashes.
No se declaran los 56/92 resultados publicados como pruebas ejecutadas ahora.
