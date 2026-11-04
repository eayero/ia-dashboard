# Entrada para Codex y otros agentes

Lee [README.md](README.md), [COMO-TRABAJAMOS.md](COMO-TRABAJAMOS.md) y
[config/project.json](config/project.json). Continúa por estado, tareas y decisiones
indicados en la guía. Preserva instrucciones locales más específicas.

Con terminal, ejecuta el diagnóstico de solo lectura:

    node scripts/agents/setup.mjs --root .

Genera con --write solo si el encargo lo autoriza. Lee los perfiles pertinentes en
agents/generated antes de delegar; definirlos no ejecuta agentes ni amplía permisos.
Codex usa estas instrucciones y perfiles; no presupongas el formato de Claude.
Las reglas comunes viven en la guía compartida, no duplicadas en las entradas.
