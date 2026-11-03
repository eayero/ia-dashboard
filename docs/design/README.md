# Contrato visual inicial — aprobado

Dirección visual aprobada expresamente por el usuario el 2026-11-03.

Superficie: aplicación operativa diaria de ACC, en español. Audiencia: propietario,
gestores y revisores que necesitan identificar ejecución, bloqueos y decisiones.

[Maqueta local de resumen](overview.html), con datos sintéticos explícitos.
Dirección: navegación verde oscuro, superficie clara, tipografía del sistema,
densidad moderada, tabla como vista primaria, inbox lateral. Sin gráficos decorativos.
Acción primaria crear tarea; prioridad visual para bloqueos y aprobaciones.

Viewports objetivo: 1440x900 y 390x844. En móvil: navegación compacta, acciones
apiladas y tabla con desplazamiento identificado. Foco visible y etiquetas explícitas.

Estados a implementar y comprobar: carga con estructura estable, vacío con acción,
error con reintento, parcial/desactualizado con operaciones críticas bloqueadas,
éxito con versión confirmada y permiso insuficiente sin acción habilitada.

La maqueta no es aplicación ni evidencia de revisión accesible completa.
La SPA real implementa esta dirección y se revisó en 1440x900 y 390x844, con
estados de carga, vacío, error, desconexión, éxito y consulta. Evidencia y límites
de esa revisión: [dashboard local](../runbooks/web.md).
