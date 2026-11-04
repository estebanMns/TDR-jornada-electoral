import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    testTimeout: 15_000,
    // Las pruebas comparten un Redis real: se ejecutan en serie.
    fileParallelism: false,
  },
});
