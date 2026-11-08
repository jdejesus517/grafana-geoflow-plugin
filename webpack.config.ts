// Extends the scaffold's webpack config (.config/, managed by create-plugin), following
// https://grafana.com/developers/plugin-tools/how-to-guides/extend-configurations
// Keep this minimal: anything added here has to survive `create-plugin update`.
import path from 'node:path';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import type { Configuration } from 'webpack';
import { merge } from 'webpack-merge';
import grafanaConfig, { type Env } from './.config/webpack/webpack.config';
import { ALLOWED_LICENSES, LICENSE_EXCEPTIONS, NOTICES_HEADER } from './webpack/licenses';
import { ThirdPartyNoticesPlugin } from './webpack/ThirdPartyNoticesPlugin';

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);
  return merge(baseConfig, {
    cache: {
      type: 'filesystem',
      // The scaffold lists only its own config; changes to these must invalidate the cache too.
      // Webpack treats a dependency as a directory only with a trailing slash.
      buildDependencies: {
        config: [path.resolve(process.cwd(), 'webpack.config.ts'), path.resolve(process.cwd(), 'webpack') + '/'],
      },
    },
    plugins: [
      // The scaffold copies LICENSE but not NOTICE, which carries the map data attribution.
      new CopyWebpackPlugin({ patterns: [{ from: path.resolve(process.cwd(), 'NOTICE'), to: '.' }] }),
      new ThirdPartyNoticesPlugin({
        filename: 'THIRD_PARTY_NOTICES.txt',
        prebundled: ['maplibre-gl'],
        header: NOTICES_HEADER,
        allowedLicenses: ALLOWED_LICENSES,
        licenseExceptions: LICENSE_EXCEPTIONS,
      }),
    ],
    ignoreWarnings: [
      // MapLibre's cross-origin worker fallback builds a URL from a variable. It never runs here:
      // the engine sets a same-origin worker URL (src/engine/maplibre/workerUrl.ts).
      {
        module: /node_modules[\\/]maplibre-gl[\\/]/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
    ],
  });
};

export default config;
