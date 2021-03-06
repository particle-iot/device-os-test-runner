class SpecError extends Error {
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

class RunnerError extends Error {
  constructor(msg) {
    super(msg);
    Error.captureStackTrace(this, this.constructor);
  }
}

class InternalError extends Error {
  constructor(msg) {
    super(msg || 'Internal error');
    Error.captureStackTrace(this, this.constructor);
  }
}

function isInternalError(error) {
  return (error instanceof InternalError || error instanceof TypeError || error instanceof ReferenceError ||
      error instanceof SyntaxError);
}

module.exports = {
  SpecError,
  RunnerError,
  InternalError,
  isInternalError
};
