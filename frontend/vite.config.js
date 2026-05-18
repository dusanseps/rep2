import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
export default defineConfig({
  plugins: [
    process.env.NODE_ENV === 'development' ? devtools() : undefined,
    solidPlugin(),
    tailwindcss(),
  ].filter(Boolean),
  server: {
    port: 3300,
    // Volania na /api/* sa presmerujú na lokálny Express backend (port 5300).
    // Backend ďalej proxuje na SharePoint, ak je token k dispozícii.
    proxy: {
      '/api': {
        target: 'http://localhost:5300',
        changeOrigin: false,
      },
      '/uploads': {
        target: 'http://localhost:5300',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'esnext',
  },
});
