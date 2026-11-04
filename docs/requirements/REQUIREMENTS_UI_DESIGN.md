# Interfaz de requisitos — propuesta para aprobación

Fecha: 2026-11-04. Trabajo: ACC-LOCAL-014 / TASK-15.
Estado: alternativa A aprobada por el usuario para implementar («si procede»).

## Objetivo

Permitir que las personas consulten, propongan, aprueben y evalúen requisitos desde
el dashboard, usando la API ya publicada en ee55b37. Completar la experiencia
humana de FR-004 y Q23/Q24 sin nuevas entidades, permisos ni migraciones.

## Tres alternativas visuales

[Comparativa interactiva](../design/requirements-options.html), con datos
sintéticos explícitos y vista móvil. Los botones de negocio no guardan cambios.

| Alternativa                 | Ventaja                                                      | Coste                                         |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| A. Tabla y detalle lateral  | Conserva la visión del catálogo y el patrón actual de tareas | El contenido detallado tiene menos ancho      |
| B. Lista y área de revisión | Facilita lectura prolongada e historial por requisito        | Muestra menos requisitos simultáneamente      |
| C. Bandeja de aprobaciones  | Prioriza propuestas e impactos que requieren acción          | El catálogo completo necesita otra navegación |

Alternativa elegida y aprobada: A. Se conservan
navegación verde oscuro, fondo claro, tipografía del sistema y densidad moderada.
No hay un cambio de marca ni nuevos patrones visuales de toda la aplicación.

## Alcance propuesto para A

- Entrada «Requisitos» en la navegación del proyecto; tabla con ID/título, tipo,
  propuesta vigente, revisión aprobada y número de impactos pendientes.
- Búsqueda por ID/título y filtros de tipo, propuesta pendiente e impacto. Los
  recuentos provienen del snapshot completo, no de una página parcial.
- Detalle lateral en escritorio y diálogo de ancho disponible en móvil. URL con
  projectId y requirementId conserva el elemento seleccionado tras recargar.
- Secciones «Contenido», «Tareas» e «Historial». Siempre distinguir propuesta
  pendiente de revisión aprobada; no presentar una propuesta como alcance vigente.
- Crear propuesta con título, descripción y tipo. Proponer sucesora exige motivo
  y crea una revisión nueva, sin sobrescribir contenido anterior.
- Aprobar muestra revisión exacta, contenido y tareas afectadas antes de confirmar.
  Solo OWNER/ADMIN/MANAGER pueden aprobar, vincular/retirar tareas y evaluar impacto.
  REVIEWER puede proponer según permisos actuales; VIEWER solo consulta.
- Vincular tarea mediante selección del proyecto actual y motivo. Retirar vínculo
  exige motivo y conserva las evaluaciones históricas.
- Evaluar impacto exige motivo y revisión aprobada exacta. Mostrar las tareas que
  siguen pendientes de otros requisitos, sin prometer que una evaluación resuelve
  todos sus bloqueos. Las tareas DONE conservan estado y validación histórica.
- El detalle de tarea muestra sus requisitos vinculados y permite abrir el
  requisito correspondiente. Atención pendiente incluye impactos y alertas de
  requisitos, con enlace al detalle donde se pueden revisar.

## Consistencia y estados

Reutilizar snapshot/delta/WS y TanStack Query. Claves de consultas ligadas a
proyecto e identidad; cambiar proyecto o salir elimina el contexto anterior.
Los comandos reutilizan cookie/CSRF, claves idempotentes y versiones del servidor.
No añadir validaciones humanas, claims o gates inventados para requisitos.

Carga con estructura estable; vacío con acción permitida; error con reintento;
consulta sin acciones de escritura; confirmación tras respuesta del servidor.
Datos incompletos, antiguos, sin conexión o de proyecto archivado impiden mutar.
Si cambian requisito o tarea vinculada, se exige recargar y revisar antes de actuar.
Un conflicto no se reenvía automáticamente ni reemplaza un formulario introducido
por el usuario sin avisar. Mostrar mensajes comprensibles de revisión obsoleta,
vínculo existente, permiso insuficiente y recurso retirado.

## Implementación prevista

React y estilos existentes, sin instalar dependencias. Nuevo módulo de requisitos
con tabla/detalle/formularios; ampliar navegación, búsqueda de ruta, atención y
enlaces desde tareas. Extraer selección de contenido y recuentos a funciones puras
para comprobar revisión vigente/propuesta/impacto con datos reales de contratos.
La API y la migración 008 permanecen como base; no ampliar el alcance del backend.

## Verificación

Pruebas de selección de revisiones y de impactos múltiples. Navegador real con
API existente en un entorno de prueba: crear, proponer sucesora, aprobar,
vincular/evaluar/retirar, historial, conflictos y permisos de consulta. Comprobar
teclado, foco/Escape, mensajes y recarga de enlaces directos en 1440×900 y 390×844.
Revisar vacío, carga, error, desconexión y pérdida de permisos sin persistir secretos.
Ejecutar tipos, lint, formato, build y suites aplicables; revisión propia declarada.

El usuario aprobó la alternativa A después de revisar la propuesta. La publicación o
actualización de la instancia se registrará según el alcance autorizado vigente.
