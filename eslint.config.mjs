import { defineConfig } from 'eslint/config';
import baseConfig from './.config/eslint.config.mjs';

export default defineConfig([
  {
    ignores: [
      '**/logs',
      '**/*.log',
      '**/npm-debug.log*',
      '**/yarn-debug.log*',
      '**/yarn-error.log*',
      '**/.pnpm-debug.log*',
      '**/node_modules/',
      '.yarn/cache',
      '.yarn/unplugged',
      '.yarn/build-state.yml',
      '.yarn/install-state.gz',
      '**/.pnp.*',
      '**/pids',
      '**/*.pid',
      '**/*.seed',
      '**/*.pid.lock',
      '**/lib-cov',
      '**/coverage',
      '**/dist/',
      '**/artifacts/',
      '**/work/',
      '**/ci/',
      'test-results/',
      'playwright-report/',
      'blob-report/',
      'playwright/.cache/',
      'playwright/.auth/',
      '**/.idea',
      '**/.eslintcache',
    ],
  },
  ...baseConfig,
  {
    // The map engine must stay independent of Grafana (docs/architecture.md §1, requirement 7).
    files: ['src/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@grafana/*', 'react', 'react-dom', '@emotion/*'],
              message: 'The engine layer must not depend on Grafana, React or Emotion.',
            },
            {
              group: [
                '**/panel',
                '**/panel/*',
                '**/adapter',
                '**/adapter/*',
                'panel',
                'panel/*',
                'adapter',
                'adapter/*',
              ],
              message: 'The engine layer must not import from the panel or adapter layers.',
            },
          ],
        },
      ],
    },
  },
]);
