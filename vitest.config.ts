import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // src/cinny-web/ is a nested clone left behind by makepkg's source
    // extraction; excluding so vitest doesn't double-pick its tests.
    exclude: ['node_modules/**', 'dist/**', 'src/cinny-web/**'],
  },
});
