# Comandos de verificación por alcance

## Protocolo y generación

```powershell
node --test tests/agents-setup.test.mjs tests/agent-protocol.test.mjs
node scripts/agents/setup.mjs --root . --check
node scripts/agents/verify-migration.mjs
node node_modules/eslint/bin/eslint.js scripts/agents/setup.mjs tests/agents-setup.test.mjs tests/agent-protocol.test.mjs
node node_modules/prettier/bin/prettier.cjs --check .
git -c core.autocrlf=false diff --check
```

Dry-run: `node scripts/agents/setup.mjs --root .`; preparación autorizada:
añadir --write. --force solo para salidas gestionadas, tras revisar necesidad.
No instalar herramientas para ejecutar estos comandos sin autorización.

verify-migration es la comprobación puntual de esta adopción contra edaf57d:
no debe convertirse en un gate que impida cambios funcionales autorizados futuros.

## Producto, cuando un encargo lo requiera

Los scripts válidos están en package.json: test, test:integration, typecheck,
typecheck:foundation, lint, format:check, build. pnpm local puede requerir añadir
`.tools/node_modules/pnpm` al PATH. Integraciones usan temporalmente 55173:
no detener UI ni infraestructura sin necesidad del encargo. Consultar
[runbook local](../runbooks/local.md). No editar scripts ni rebajar controles para
que pase la migración. No atribuir PASS a un comando no ejecutado en esta entrega.
