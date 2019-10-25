export class RunnerError extends Error {
  constructor(msg) {
    super(msg);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InternalError extends RunnerError {
  constructor(msg) {
    super(msg || 'Internal error');
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SpecError extends RunnerError {
  constructor(msg, file) {
    if (file) {
      super(`${file}: ${msg}`);
      this.file = file;
    } else {
      super(msg);
    }
    Error.captureStackTrace(this, this.constructor);
  }
}

export function isInternalError(error) {
  return (error instanceof InternalError || error instanceof TypeError || error instanceof ReferenceError ||
      error instanceof SyntaxError);
}
