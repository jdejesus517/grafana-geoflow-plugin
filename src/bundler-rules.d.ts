// The scaffold's .config/types/bundler-rules.d.ts covers images and fonts but not CSS. A `?raw`
// import is the file's text (webpack.config.ts); used for MapLibre's stylesheet, which the panel
// scopes under the map.
declare module '*.css?raw' {
  const text: string;
  export default text;
}
