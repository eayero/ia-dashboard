# Publicación y despliegue de sprints, preguntas y decisiones

Autorizado por el usuario: «publica y despliega los cambios» (2026-11-06).
Destino: rama actual `feat/acc-foundation` e instancia Docker local
http://localhost:55173. No incluye merge, instalación de dependencias nuevas ni
aprobación de requisitos, decisiones de planificación o cierre humano de tareas.

1. Verificar fuente, artefactos, contrato y comprobaciones de la entrega.
2. Publicar commit de implementación y verificar el SHA remoto. Registrar
   evidencia CODE/TEST bajo el contrato desplegado 011 antes de activar los
   controles 012; el registro no equivale a aceptación humana.
3. Conservar imágenes anteriores y crear imágenes derivadas de los runtimes
   locales verificados: fuentes exportadas, dist y migraciones actuales. Comprobar
   que manifiestos, lockfile y políticas de dependencias no han cambiado.
4. Cerrar sesión de trabajo, detener API/UI/worker, crear respaldo privado de
   PostgreSQL y registrar filas/checksums y huellas de archivos de credenciales.
5. Aplicar 012/013 con el migrador transaccional, ejecutar bootstrap conservador
   y arrancar API/UI. Mantener worker detenido durante la preparación humana.
6. Ejecutar por REST humano `execution/prepare` para cerrar tramos y revocar
   claims anteriores. No inventar sprints ni elegir principales ambiguos. La
   planificación pendiente queda visible en la UI y bloquea trabajo por diseño.
7. Comprobar conservación de datos y credenciales, migraciones, servicios,
   OpenAPI, 34 herramientas MCP y flujos de navegador. Iniciar worker.
8. Publicar informe final y documentación de continuidad; leer contexto/delta
   nativos completos. Mantener los estados de tareas que imponga el servidor.

Rollback: conservar respaldo e IDs/imágenes anteriores. Las migraciones son
aditivas, pero no deshacerlas ni restaurar sobre cambios posteriores de usuarios
sin verificar primero la situación. No se borran volúmenes ni migraciones.
