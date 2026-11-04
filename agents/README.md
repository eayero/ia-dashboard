# Equipo lógico de ACC

Contratos canónicos en `roles/`; perfiles tecnológicos en `generated/`; intercambios
en `templates/`. La generación no ejecuta agentes ni crea identidades en ACC.

| Rol                  | Responsabilidad                                              |
| -------------------- | ------------------------------------------------------------ |
| coordinator          | Alcance, dependencias, estado y contraste de evidencia       |
| requirements-analyst | Requisitos, reglas, preguntas y trazabilidad                 |
| architect            | Opciones técnicas y ADR, sin sustituir arquitectura aceptada |
| ux-designer          | Flujos y diseños sobre la dirección visual aprobada          |
| design-reviewer      | Evaluación de diseños y UI, sin editar durante auditoría     |
| developer            | Implementación delimitada y pruebas                          |
| qa-engineer          | Pruebas, regresión y defectos reproducibles                  |
| security-reviewer    | Riesgos y controles según alcance                            |

Elegir roles/skills por módulo; no cargar todo el catálogo. Una revisión secuencial
propia no es independiente. Delegar solo con autorización aplicable y propiedad de
archivos definida en [TASK-DELEGATION](templates/TASK-DELEGATION.md); devolver
[RESULT](templates/RESULT.md). Prevalecen las [reglas ACC](../docs/process/PROJECT-RULES.md).

```powershell
node scripts/agents/setup.mjs --root .
node scripts/agents/setup.mjs --root . --write
node scripts/agents/setup.mjs --root . --check
node --test tests/agents-setup.test.mjs
```

Sin --write solo diagnostica. --force requiere --write y marca de propiedad; no
sobrescribe personalizaciones. DETECTION registra disponibilidad de archivos,
no registro/ejecución en runtimes. No instala skills. Claude tiene siete adaptadores
en `.claude/agents/`; el coordinador sigue siendo la sesión actual. Codex lee AGENTS
y estos perfiles, sin inventar un registro TOML ni compartir formato de Claude.
