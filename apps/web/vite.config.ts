import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = Object.fromEntries(
  ['/api', '/mcp', '/.well-known/oauth-protected-resource/mcp', '/ws'].map((path) => [
    path,
    { target: 'http://127.0.0.1:53000', changeOrigin: false, ws: path === '/ws' },
  ]),
);
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 55173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 55173, strictPort: true, proxy },
});
