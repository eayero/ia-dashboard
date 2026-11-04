# Plan previo de migración local

Origen y decisiones: [diagnóstico](DIAGNOSIS.md). Autorización: petición actual del
usuario; sin cambios de producto, arquitectura, instalaciones o publicaciones.
La revisión se hará secuencialmente: no se lanzan subagentes.

1. **Diagnóstico y preservación.** Leer toda la plantilla, inventariar fuentes y
   herramientas, consultar ACC, registrar hashes de plantilla y base Git limpia.
   Guardar copias exactas de las instrucciones anteriores.
2. **Configuración y gobierno.** Integrar entradas cortas AGENTS/CLAUDE/guía común,
   protocolo universal por referencia, precedencia y reglas ACC; configurar stack,
   permisos, roles y fuentes. No inventar autorizaciones persistentes ni ramas.
3. **Documentos y trazabilidad.** Crear índices de proyecto, requisitos, decisiones,
   arquitectura, tareas, evidencia y handoff que remitan a las fuentes actuales.
   Incorporar solo la nueva tarea ACC-LOCAL-019, con IDs y criterios anteriores intactos.
4. **Generación.** Adaptar y probar el generador de instrucciones, verificar skills
   ECC instaladas sin copiarlas y generar ocho perfiles y siete adaptadores Claude.
   Codex usa AGENTS y los perfiles canónicos, sin inventar soporte de otro formato.
5. **Validación.** Pruebas del generador y de invariantes de migración, enlaces,
   JSON/frontmatter, idempotencia/dry-run, skills faltantes y permisos. Comprobar
   CLI/compatibilidad disponible sin ejecutar modelos ni delegaciones. Hashes de
   código/arquitectura y documentos preservados iguales a la base; Git sin acciones
   de escritura. Lint/formato pertinentes. Suites del producto: NOT_RUN si no aplican.
6. **Cierre.** Registrar resultados y límites reales, renovar/finalizar sesión MCP,
   verificar lectura y delta. Sin publicar, la evidencia formal HTTPS y DONE de
   esta nueva tarea pueden quedar pendientes sin simular URLs o permisos.

## Criterios de aceptación

El producto no cambia; las reglas de usuario prevalecen; las fuentes históricas
siguen accesibles; ambos harnesses tienen ruta de arranque verificable; los perfiles
no elevan permisos ni ejecutan procesos; la disponibilidad ECC es reproducible y
las limitaciones de ejecución se declaran. Estado detallado por paso en RESULT.json.
