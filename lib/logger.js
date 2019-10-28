import chalk from 'chalk';

import * as util from 'util';
import * as os from 'os';

/**
 * Logging levels.
 */
export const LogLevel = {
	ERROR: 'error',
	WARN: 'warn',
	INFO: 'info',
	VERBOSE: 'verbose',
	DEBUG: 'debug',
	SILLY: 'silly'
};

const LOG_LEVEL_VALUES = {
	error: 0,
	warn: 1,
	info: 2,
	verbose: 3,
	debug: 4,
	silly: 5
};

const TAB_SIZE = 2;

/**
 * Simple logger with a winston-like API.
 */
export class Logger {
	constructor({ level, stream } = {}) {
		if (level) {
			this._level = LOG_LEVEL_VALUES[level];
			if (this._level === undefined) {
				throw new RangeError(`Invalid logging level: ${level}`);
			}
		} else {
			this._level = LogLevel.INFO;
		}
		this._stream = stream || process.stderr; // Print to stderr by default
		this._padding = '';
	}

	error(...args) {
		this._log(LOG_LEVEL_VALUES.error, ...args);
	}

	warn(...args) {
		this._log(LOG_LEVEL_VALUES.warn, ...args);
	}

	info(...args) {
		this._log(LOG_LEVEL_VALUES.info, ...args);
	}

	verbose(...args) {
		this._log(LOG_LEVEL_VALUES.verbose, ...args);
	}

	debug(...args) {
		this._log(LOG_LEVEL_VALUES.debug, ...args);
	}

	silly(...args) {
		this._log(LOG_LEVEL_VALUES.silly, ...args);
	}

	log(level, ...args) {
		const levelVal = LOG_LEVEL_VALUES[level];
		if (levelVal === undefined) {
			throw new RangeError(`Invalid logging level: ${level}`);
		}
		this._log(levelVal, ...args);
	}

	indent(count = 1) {
		const n = this._padding.length + TAB_SIZE * count;
		this._padding = ' '.repeat(n);
	}

	unindent(count = 1) {
		const n = Math.max(this._padding.length - TAB_SIZE * count, 0);
		this._padding = ' '.repeat(n);
	}

	_log(level, ...args) {
		if (level <= this._level) {
			let msg = util.format(...args);
			if (level <= LOG_LEVEL_VALUES.error) {
				msg = chalk.red(msg);
			} else if (level <= LOG_LEVEL_VALUES.warn) {
				msg = chalk.yellow(msg);
			} else if (level <= LOG_LEVEL_VALUES.info) {
				msg = chalk.dim(msg);
			} else {
				msg = chalk.gray(msg);
			}
			this._stream.write(this._padding);
			this._stream.write(msg);
			this._stream.write(os.EOL);
		}
	}
};
