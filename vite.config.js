import { defineConfig } from 'vite';
import { loadConfig } from './src/config.js';
const port = loadConfig().controlPort;
export default defineConfig({
  server: { proxy: { '/api': {
    target: 'http://127.0.0.1:' + port, changeOrigin: true,
    configure(proxy) { proxy.on('proxyReq', req => { req.setHeader('origin', 'http://127.0.0.1:' + port); }); },
  } } },
});
