import chalk from 'chalk';

import * as util from 'util';

/**
 * Logging levels.
 */
export const LOG_LEVELS = {
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
	constructor({ level }) {
		if (level) {
			this._level = LOG_LEVELS[level];
			if (this._level === undefined) {
				throw new Error(`Invalid logging level: ${level}`);
			}
		} else {
			this._level = LOG_LEVELS.warn;
		}
	}

	error(...args) {
		this._log(LOG_LEVELS.error, ...args);
	}

	warn(...args) {
		this._log(LOG_LEVELS.warn, ...args);
	}

	info(...args) {
		this._log(LOG_LEVELS.info, ...args);
	}

	verbose(...args) {
		this._log(LOG_LEVELS.verbose, ...args);
	}

	debug(...args) {
		this._log(LOG_LEVELS.debug, ...args);
	}

	silly(...args) {
		this._log(LOG_LEVELS.silly, ...args);
	}

	log(level, ...args) {
		const numLevel = LOG_LEVELS[level];
		if (numLevel === undefined) {
			throw new Error(`Invalid logging level: ${level}`);
		}
		this._log(numLevel, ...args);
	}

	_log(level, ...args) {
		if (level <= this._level) {
			let msg = util.format(...args);
			if (level <= LOG_LEVELS.error) {
				msg = chalk.red(msg);
			} else if (level <= LOG_LEVELS.warn) {
				msg = chalk.yellow(msg);
			} else if (level <= LOG_LEVELS.info) {
				msg = chalk.dim(msg);
			} else {
				msg = chalk.gray(msg);
			}
			console.log(msg);
		}
	}
};
