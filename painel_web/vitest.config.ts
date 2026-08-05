import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Config de TESTES (separada da vite.config para não afetar o build). Ambiente
// jsdom para testes de componente/hook; testes puros também rodam aqui.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
