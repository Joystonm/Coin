import { defineConfig } from 'vitest/config';

/**
 * The test suite runs against the same pure modules the product ships.
 *
 * Nothing here is mocked: the tests exercise the real parity, depth, crossing
 * and history code with hand-built inputs and with the offline fixture. If a
 * test passes, the number the CLI prints and the number the page shows are
 * the number this code produced.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});
