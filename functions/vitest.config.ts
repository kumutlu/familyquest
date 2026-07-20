import { defineConfig } from 'vitest/config';

// Local config for the Functions package. Keeps the focused Functions tests
// isolated from the web app's vitest config (which references a setup file that
// does not exist in this package).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // No setup file required for the trusted-backend unit tests.
  },
});
