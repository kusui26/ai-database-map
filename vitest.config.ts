import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      // tsconfig の paths（@/* → ./src/*）を Vitest でも解決する。
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
