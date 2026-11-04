// Extends the scaffold's webpack config (.config/, managed by create-plugin), following
// https://grafana.com/developers/plugin-tools/how-to-guides/extend-configurations
// Keep this minimal: anything added here has to survive `create-plugin update`.
import path from 'node:path';
import type { Configuration } from 'webpack';
import { merge } from 'webpack-merge';
import grafanaConfig, { type Env } from './.config/webpack/webpack.config';
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
      new ThirdPartyNoticesPlugin({
        filename: 'THIRD_PARTY_NOTICES.txt',
        prebundled: ['maplibre-gl'],
        header: `GeoFlow bundles the third-party packages listed below. Each is distributed under
its own license, reproduced here. GeoFlow itself is licensed under the Apache
License, Version 2.0 (see LICENSE).

Map data shown by the default basemap is © OpenStreetMap contributors, available
under the Open Database License: https://www.openstreetmap.org/copyright`,
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
