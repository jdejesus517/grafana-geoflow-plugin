// The scaffold's .config/types/bundler-rules.d.ts covers images and fonts but not CSS, which
// the scaffold's webpack config does load (style-loader). Used for MapLibre's stylesheet.
declare module '*.css';
