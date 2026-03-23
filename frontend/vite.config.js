import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // If VITE_API_URL is set (e.g. in .env.production pointing at Render),
  // don't proxy — axios will call the Render URL directly.
  // If not set, proxy /api to local backend on port 5000.
  const useProxy = !env.VITE_API_URL;

  return {
    plugins: [react()],
    server: {
      port: 3000,
      ...(useProxy && {
        proxy: {
          '/api': {
            target: 'http://localhost:5000',
            changeOrigin: true,
          },
        },
      }),
    },
  };
});
