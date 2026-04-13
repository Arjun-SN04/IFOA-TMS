import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.VITE_API_URL && env.VITE_API_URL.trim();

  // If VITE_API_URL is set and non-empty, axios calls Render directly — no proxy needed.
  // If VITE_API_URL is empty/unset (local dev), proxy /api → localhost:5000.
  const useProxy = !apiUrl;

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://localhost:5000',
          changeOrigin: true,
          // If local backend is not running this will fail fast and show a clear error
        },
      },
    },
  };
});
