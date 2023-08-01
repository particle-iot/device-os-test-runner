class SpecError extends Error {
	constructor(msg, file) {
		if (file) {
			super(`${file}: ${msg}`);
			this.file = file;
		} else {
			super(msg);
		}
		this.name = this.constructor.name;
	}
}

class RunnerError extends Error {
	constructor(msg, code) {
		super(msg);
		this.name = this.constructor.name;
		this.code = code;
	}
}

class InternalError extends Error {
	constructor(msg) {
		super(msg || 'Internal error');
		this.name = this.constructor.name;
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
