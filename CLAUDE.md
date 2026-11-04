# Entrada para Claude Code

Aplica [AGENTS.md](AGENTS.md) y [COMO-TRABAJAMOS.md](COMO-TRABAJAMOS.md).
El arranque incluye config/project.json y diagnóstico de stack de solo lectura.
No presume ejecución automática de scripts, skills o agentes al abrir una carpeta.

Los adaptadores de .claude/agents remiten a perfiles canónicos en agents/generated.
Comprueba compatibilidad del runtime y autorización antes de ejecutarlos. No copies
sus formatos a Codex ni declares QA independiente sin una revisión distinta real.
La continuidad compartida está en docs/handoffs/LATEST.md, no en conversaciones privadas.
