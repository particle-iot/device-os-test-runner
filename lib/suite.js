import { RunMode, config } from './config';

/**
 * Wrapper class for a Mocha suite.
 */
export class SuiteWrapper {
	constructor({ suite, log }) {
		this._log = log; // Logger instance
		this._dryRun = false; // Run mode
	}

	async init(ctx) {
		this._dryRun = ctx.particle.dryRun;
		if (this._dryRun) {
			ctx.skip();
		}
	}

	async shutdown() {
	}
}
