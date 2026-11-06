/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages serves the app under /fitness-dashboard/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/fitness-dashboard/' : '/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
  },
}));
