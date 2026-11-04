import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildOpenApi } from '../apps/api/src/openapi/document.ts';
const target = fileURLToPath(new URL('../docs/openapi.json', import.meta.url));
const expected = JSON.stringify(buildOpenApi(), null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (
    JSON.stringify(JSON.parse(await readFile(target, 'utf8'))) !==
    JSON.stringify(JSON.parse(expected))
  )
    throw new Error(
      'docs/openapi.json está desactualizado: ejecutar node --import tsx scripts/export-openapi.mjs',
    );
  console.log('OpenAPI artifact is current');
} else {
  await writeFile(target, expected);
  console.log('Generated docs/openapi.json');
}
