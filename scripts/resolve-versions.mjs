// Read-only registry inspection. Writes no configuration and never reads npm credentials.
const names = [
  'typescript',
  'turbo',
  'eslint',
  '@eslint/js',
  'typescript-eslint',
  'prettier',
  'vitest',
  'tsx',
  '@types/node',
  '@types/pg',
  '@types/express',
  '@types/cookie-parser',
  '@types/express-session',
  '@types/react',
  '@types/react-dom',
  '@nestjs/core',
  '@nestjs/common',
  '@nestjs/platform-express',
  '@nestjs/swagger',
  '@nestjs/websockets',
  '@nestjs/platform-socket.io',
  'reflect-metadata',
  'rxjs',
  'zod',
  'pg',
  'prisma',
  '@prisma/client',
  '@prisma/adapter-pg',
  'react',
  'react-dom',
  'vite',
  '@vitejs/plugin-react',
  '@tanstack/react-router',
  '@tanstack/react-query',
  'tailwindcss',
  '@tailwindcss/vite',
  'lucide-react',
  'socket.io',
  'socket.io-client',
  'redis',
  'jose',
  'openid-client',
  'cookie-parser',
  'express-session',
  'connect-pg-simple',
  '@types/connect-pg-simple',
  'helmet',
  'express-rate-limit',
  'express',
  '@modelcontextprotocol/server',
  '@modelcontextprotocol/node',
  '@playwright/test',
  '@axe-core/playwright',
];
const entries = [];
for (const name of names) {
  let data;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const tag = /prisma/.test(name) ? '7.6.0' : 'latest';
      const response = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(name)}/${tag}`,
        { signal: AbortSignal.timeout(20000) },
      );
      if (!response.ok) throw new Error(`${name}: ${response.status}`);
      data = await response.json();
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  entries.push([name, { version: data.version, engines: data.engines }]);
}
console.log(JSON.stringify(Object.fromEntries(entries), null, 2));
