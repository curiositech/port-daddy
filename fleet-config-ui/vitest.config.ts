import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import type { PluginOption } from 'vite';

// Component tests run in jsdom against the real React tree. This file is
// intentionally NOT part of the `tsc -b` project graph — vitest esbuild-loads
// it at runtime, and the app build never needs it. The `react()` plugin is
// cast to vitest's bundled-Vite PluginOption to side-step the dual-Vite
// (vite 8 / rolldown vs vitest's vendored vite) plugin-type mismatch.
export default defineConfig({
  plugins: [react() as unknown as PluginOption],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
