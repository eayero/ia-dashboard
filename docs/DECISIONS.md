# Acuerdos de producto y ejecución

Fecha: 2026-11-02. Las 40 recomendaciones de la entrevista `grilling` fueron
aceptadas expresamente por el usuario. El cierre de la entrevista autorizó
documentar e iniciar la fundación y primera entrega vertical; no autoriza commit,
push, merge ni despliegue. Este documento complementa la especificación v1.1.

| ID  | Decisión aceptada                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Una organización, varios humanos y agentes, membresía explícita por proyecto; sin registro público.                                         |
| Q2  | Primera entrega vertical separada del MVP P0 completo.                                                                                      |
| Q3  | La exclusividad se impone en ACC; los archivos externos se aíslan mediante worktrees y PR.                                                  |
| Q4  | Todo cierre DONE requiere aprobación humana en el MVP.                                                                                      |
| Q5  | Distinguir evidencia declarada, comprobada por integración y aceptada por humano.                                                           |
| Q6  | OWNER/ADMIN puede revocar claims con motivo, fencing y auditoría.                                                                           |
| Q7  | Commit, push, merge y despliegue requieren autorización expresa independiente.                                                              |
| Q8  | Demostración local reproducible con Docker Compose y OIDC real de desarrollo.                                                               |
| Q9  | OWNER/ADMIN crea agentes y emite/revoca credenciales de ámbito proyecto; el agente no se suplanta.                                          |
| Q10 | Un humano puede aprobar revisión, QA y cierre; cada aprobación se registra por separado.                                                    |
| Q11 | Cambios sustanciales invalidan aprobaciones afectadas; comentarios y presentación no.                                                       |
| Q12 | Claim expirado/revocado deja IN_PROGRESS sin propietario y permite recuperación autorizada.                                                 |
| Q13 | La respuesta humana confirmada resuelve la pregunta; la propuesta de agente necesita aceptación.                                            |
| Q14 | Dependencia dura satisfecha solo por DONE. Reapertura bloquea nuevos claims/avances; DONE dependiente recibe alerta.                        |
| Q15 | Humanos y agentes pueden ejecutar tareas con claims exclusivos y las mismas garantías.                                                      |
| Q16 | Desconexión permite trabajo local, pero registrar avances requiere reconciliar contexto y propiedad.                                        |
| Q17 | Criterios estructurados con ID, obligatoriedad, evidencias, revisión y validador.                                                           |
| Q18 | MVP sin adjuntos binarios; enlaces Git/CI, hashes y resultados estructurados con procedencia.                                               |
| Q19 | Similitud admite creación con motivo explícito; identidad externa exacta devuelve recurso existente.                                        |
| Q20 | Idempotencia retiene respuestas siete días inicialmente; external_ref conserva identidad duradera.                                          |
| Q21 | Archivar revoca claims, impide nuevas sesiones/mutaciones y conserva consultas; OWNER/ADMIN reactiva.                                       |
| Q22 | Iteración activa admite cambios de alcance motivados; conserva baseline y diferencia. Canceladas no cuentan como completadas.               |
| Q23 | OWNER/ADMIN/MANAGER aprueba requisitos y decisiones; agentes proponen; supersesión conserva historia.                                       |
| Q24 | Nueva revisión aprobada exige evaluar impacto antes de review/QA/cierre; DONE recibe alerta sin reapertura automática.                      |
| Q25 | Nuevo bloqueo duro pasa a BLOCKED y revoca claim; vuelve READY al resolver todos los bloqueos.                                              |
| Q26 | UI inicial en español: resumen, tabla, detalle e inbox; revisar diseño antes de implementar.                                                |
| Q27 | Notificaciones persistentes dentro de ACC; sin correo/Slack inicial. Leer no resuelve.                                                      |
| Q28 | Especificación, acuerdos y estado bootstrap versionados y enlazados desde README.                                                           |
| Q29 | OWNER/ADMIN puede revisar/cerrar; MANAGER planifica; REVIEWER revisa/QA/cierra; roles acumulables; VIEWER consulta. Agentes nunca aprueban. |
| Q30 | Claim humano se adquiere explícitamente; detalle conectado renueva; dejar de trabajar libera; cerrar navegador deja expirar.                |
| Q31 | Agentes aportan informes de revisión/QA sin claim de implementación; rechazo humano vuelve IN_PROGRESS sin propietario.                     |
| Q32 | Evidencia de código identifica repositorio y commit; pruebas referencian ese commit; otras tareas usan revisión equivalente.                |
| Q33 | Evidencias HTTPS; sin descargas arbitrarias del servidor; comprobación solo con integración autorizada.                                     |
| Q34 | OWNER/ADMIN pausa nuevas adquisiciones sin revocar automáticamente claims existentes.                                                       |
| Q35 | SDK MCP estable y compatibilidad oficial negociada; interoperabilidad solo tras smoke real Codex/Claude Code.                               |
| Q36 | Keycloak local reproducible con usuarios sintéticos; proveedor producción pendiente.                                                        |
| Q37 | Heartbeat de sesión no renueva claims; fin de sesión/revocación de credencial invalida sus claims.                                          |
| Q38 | Cambio humano sustancial sobre tarea reclamada es explícito, revoca claim y devuelve a planificación.                                       |
| Q39 | Separar versión técnica optimista de revisión del trabajo: heartbeat/comentario/prioridad no invalida aprobaciones.                         |
| Q40 | Primera demo llega a DONE e incluye rechazo por falta de evidencia/aprobación y conflicto entre agentes.                                    |

## Diferencias respecto al modelo v1.1

- Claims referencian un principal ejecutor humano o agente, y una sesión lógica.
- Roles se modelan como conjunto, no como un único valor excluyente.
- `work_revision` identifica contenido evaluado; `version` protege concurrencia.
- Revisión, QA y cierre son aprobaciones distintas de la misma `work_revision`.
- Cambios sustanciales sobre tareas reclamadas deben usar operación explícita;
  no pueden pasar por un PATCH ordinario.

## Sustituciones aprobadas después de Q1–Q40

Por petición expresa del usuario, Q8 y Q36 quedan sustituidas en su parte de
OIDC/Keycloak por autenticación propia de ACC. Los usuarios pertenecen solo a ACC,
sin registro público. ADMIN gestiona cuentas y asignaciones; recuperación mediante
contraseña temporal con cambio obligatorio. Humanos usan sesión HttpOnly y CSRF;
agentes, credenciales opacas revocables, con caducidad, scopes y audiencias API/MCP.
Se conservan IDs, permisos e historial. No se implementa un servidor OAuth propio.

Compose debe incluir backend y UI, además de PostgreSQL, Redis, migraciones,
bootstrap y worker. Estas decisiones se aplican en la especificación y runbooks;
la tabla Q1–Q40 conserva el texto original para trazabilidad.

## Decisiones aplazadas por alcance

Hosting, dominio y operación de producción se concretarán antes de publicar.
Diseño visual se presenta para revisión antes de implementar UI. Métricas avanzadas,
integraciones Git, adjuntos, organizaciones y facturación no pertenecen al primer slice.
