# Agentes de usuarios y acceso a proyectos

Petición: cada agente pertenece a un usuario; el usuario tiene su lista de agentes;
la actividad identifica al agente y a su propietario. Una configuración MCP del
agente debe servir para uno o varios proyectos autorizados.

Se separan tres conceptos: usuario humano, identidad del agente y credenciales.
Cada agente conserva un ID, nombre y propietario; puede emitir varias credenciales
API/MCP revocables. Las membresías por proyecto se asignan a la identidad del agente,
no a una credencial. Una misma credencial MCP lista y usa sus proyectos autorizados.

El usuario consulta/gestiona sus agentes y el administrador gestiona todos. Las
asignaciones requieren acceso activo del propietario al proyecto y no conceden
más capacidad de escritura que la que tiene ese usuario. No se heredan privilegios
humanos como validar DONE. Deshabilitar al propietario o retirar su acceso bloquea
a sus agentes y termina las sesiones/claims afectados. No se renuevan secretos.

Una migración nueva asigna propietarios a agentes existentes sin cambiar IDs ni
tokens: usa el creador registrado, o un único propietario local verificable del
proyecto. Si no hay una correspondencia inequívoca, falla con un error explícito.
El bootstrap preserva la propiedad. Los eventos nuevos guardan el propietario
como atribución de auditoría, además del actor agente; el historial anterior no
se reescribe para inventar una atribución histórica.

API y UI muestran propietario, agentes por usuario, proyectos de cada agente y
credenciales separadas. El token autentica al agente, el servidor resuelve al
propietario; el cliente no puede elegir identidad ni atribución al llamar MCP.

Verificar migración conservadora, aislamiento entre propietarios/proyectos,
revocación y propietario deshabilitado, dos proyectos con una credencial MCP,
auditoría con ambas identidades y recorridos de interfaz sin filtrar secretos.
