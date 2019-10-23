import chalk from 'chalk';

import * as util from 'util';

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

/**
 * Simple console logger with a winston-like API.
 */
export class Logger {
	constructor(level) {
		if (level) {
			this._level = LOG_LEVEL_VALUES[level];
			if (this._level === undefined) {
				throw new RangeError(`Invalid logging level: ${level}`);
			}
		} else {
			this._level = LogLevel.WARN;
		}
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
			console.log(msg);
		}
	}
};
