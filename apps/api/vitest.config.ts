import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The integration project has no tests yet; allow `test:integration` to succeed.
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          // Integration tests talk to real services (Postgres, PowerSync); no sharing between files.
          fileParallelism: false,
        },
      },
    ],
  },
});
