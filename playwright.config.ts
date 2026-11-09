import type { PluginOptions } from '@grafana/plugin-e2e';
import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import baseConfig from './.config/playwright.config';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig<PluginOptions>(baseConfig, {
  // See https://grafana.com/developers/plugin-tools/how-to-guides/extend-configurations#extend-the-playwright-config for further info.
  use: {
    // Provisioning lives with the Grafana deployment files (docker/grafana/), not the scaffold default.
    provisioningRootDir: join(__dirname, 'docker/grafana/provisioning'),
    // A failed attempt's screenshot, for flaky tests that pass on retry (docs/node-edge/phase_3.md, Design §4).
    screenshot: 'only-on-failure',
  },
});
