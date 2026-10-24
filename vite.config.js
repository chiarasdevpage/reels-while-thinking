import { defineConfig } from 'vite';
import { loadConfig } from './src/config.js';
import { fileURLToPath } from 'node:url';
const port = loadConfig().controlPort;
export default defineConfig({
  build: { rollupOptions: { input: {
    dashboard: fileURLToPath(new URL('./index.html', import.meta.url)),
    gameplay: fileURLToPath(new URL('./gameplay.html', import.meta.url)),
  } } },
  server: { proxy: { '/api': {
    target: 'http://127.0.0.1:' + port, changeOrigin: true,
    configure(proxy, options) { proxy.on('proxyReq', req => { req.setHeader('origin', new URL(options.target).origin); }); },
  } } },
});
