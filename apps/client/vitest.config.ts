import { defineConfig } from 'vitest/config';

// Unit tests for pure client logic (repository helpers, validation). React Native and
// PowerSync modules are not loaded here; keep testable logic free of platform imports.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
