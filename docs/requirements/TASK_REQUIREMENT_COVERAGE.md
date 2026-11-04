# Toda tarea responde a un requisito

Instrucción expresa del usuario: «No deben haber tareas sin requisitos asociados,
todas las tareas responden a un trabajo que forma parte del desarrollo de un requisito».

Toda tarea del proyecto debe tener al menos un vínculo real con el requisito
funcional o no funcional que justifica su trabajo. La asociación debe explicar
qué contribuye a implementar, preparar, documentar o verificar. Incluye BACKLOG,
DONE y CANCELLED, así como fixtures históricos de pruebas. Conservar estados,
validaciones, evidencia e identidad; un vínculo no acredita implementación.

Antes de crear trabajo, identificar el requisito. Si falta, proponerlo con fuente
y referencia estable. Completar tarea y asociación como un bloque operativo antes
de desarrollar; el API actual usa dos operaciones y todavía no exige la relación
atómicamente al crear en la versión desplegada anterior. La implementación local
[API/MCP obligatoria](TASK_REQUIREMENT_API.md) exige `requirementIds` y confirma
tarea/vínculos juntos, con protección PostgreSQL mediante migración 010.
Q24 conserva los cambios posteriores del vínculo mediante humano autorizado por
REST; no modificar BD ni suplantar aprobación humana. No retirar el último vínculo
sin haber asociado previamente su requisito sustituto.

Auditar al empezar y cerrar trabajo:

```powershell
pnpm requirements:check
```

El comando solo lee un snapshot completo por MCP, incluye todos los estados y
termina con código 1 si encuentra tareas sin requisito. No crea ni modifica datos.
Usa configuración y credenciales locales existentes, sin imprimir secretos.
La auditoría complementa la restricción de creación implementada en API/MCP y DB;
su activación en el servicio habitual requiere desplegar el código y migración 010.

## Requisitos no funcionales derivados de fuentes existentes

Propuestas importadas a ACC como DRAFT, pendientes de aprobación humana:

| ID      | Requisito                                           | Fuente y trabajo justificado                                                                                    |
| ------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| NFR-001 | Arquitectura y construcción reproducible            | Arquitectura y aceptación de SPECIFICATION; monorepo, herramientas y verificaciones reproducibles.              |
| NFR-002 | Operación persistente y recuperación del entorno    | Seguridad/operación, DoD y runbook local; arranque/reinicio con datos, permisos y credenciales conservados.     |
| NFR-003 | Trazabilidad completa y coordinación del desarrollo | MCP/integración, guía compartida e instrucción vigente; especificación, protocolo y sincronización del trabajo. |

Resultado verificado: [TASK_REQUIREMENT_COVERAGE.json](TASK_REQUIREMENT_COVERAGE.json).
El [informe inicial](ACC_REQUIREMENTS_SYNC.json) conserva la primera importación de
20 FR/27 vínculos; este resultado amplía la cobertura a todas las tareas existentes.

Instancia local actualizada con el contrato obligatorio y migración 010, commit
`94d7a34`; las notas anteriores de despliegue pendiente son históricas.
Ver [despliegue verificado](TASK_REQUIREMENT_DEPLOYMENT.json).
