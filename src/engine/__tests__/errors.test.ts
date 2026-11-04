import { WebGLUnavailableError } from '../errors';

describe('WebGLUnavailableError', () => {
  it('carries the message the panel shows', () => {
    const error = new WebGLUnavailableError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('WebGLUnavailableError');
    expect(error.message).toBe("This panel needs WebGL2, which isn't available in this browser");
  });
});
