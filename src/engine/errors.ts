/** Thrown by MapEngine.mount when the browser can't create a WebGL2 context. */
export class WebGLUnavailableError extends Error {
  constructor() {
    super("This panel needs WebGL2, which isn't available in this browser");
    this.name = 'WebGLUnavailableError';
  }
}
