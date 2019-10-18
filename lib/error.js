export class RunnerError extends Error {
  constructor(msg) {
    super(msg);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SpecError extends RunnerError {
  constructor(file, msg) {
    super(`${file}: ${msg}`);
    this.file = file;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InternalError extends RunnerError {
  constructor(msg) {
    super(msg || 'Internal error');
    Error.captureStackTrace(this, this.constructor);
  }
}
