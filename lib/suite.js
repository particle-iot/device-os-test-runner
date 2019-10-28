import { RunMode, config } from './config';

/**
 * Wrapper class for a Mocha suite.
 */
export class PlatformSuite {
	constructor({ suite, log }) {
		this._log = log; // Logger instance
		this._suite = suite; // Test suite
		this._ctx = null; // Runner context
	}

	async init(ctx) {
		this._ctx = ctx.particle;
		this._ctx.devices = [];
		const platform = this._suite.particle.platform;
		this._ctx.device = this._ctx.deviceManager.takeDevice({ platform });
		this._ctx.devices.push(this._ctx.device);
		if (this._ctx.dryRun) {
			ctx.skip();
		}
	}

	async shutdown() {
		this._ctx.devices.forEach(dev => {
			this._ctx.deviceManager.releaseDevice(dev);
		});
		delete this._ctx.devices;
		delete this._ctx.device;
		this._ctx = null;
	}
}
