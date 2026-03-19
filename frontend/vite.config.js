import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';

export default defineConfig({
  plugins: [devtools(), solidPlugin(), tailwindcss()],
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
