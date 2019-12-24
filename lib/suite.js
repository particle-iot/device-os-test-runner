import { findTestName } from './util';

import * as path from 'path';

/**
 * Wrapper class for a Mocha suite.
 */
export class PlatformSuite {
	constructor({ suite, log }) {
		this._log = log; // Logger instance
		this._suite = suite; // Test suite
		this._devTests = null; // Device tests
		this._ctx = null; // Runner context
	}

	async init(ctx) {
		this._ctx = ctx.particle;
		await this._initDevices();
		if (this._ctx.dryRun) {
			ctx.skip();
			return;
		}
		// Build and flash application binaries
		await this._flashApps();
		// Get the list of device tests
		const tests = await this._ctx.device.getTests();
		this._devTests = new Set(tests);
		this._ctx.addDeviceTests(this._suite, this._devTests);
	}

	async shutdown() {
		await this._shutdownDevices();
		this._ctx = null;
	}

	async runTest(test) {
		const name = findTestName(this._devTests, test.title);
		if (!name) {
			throw new Error(`Device test not found: ${test.title}`);
		}
		this._ctx.apiClient.setDevice(this._ctx.device); // FIXME
		await this._ctx.device.runTest(name, test.parent.particle);
	}

	async _flashApps() {
		const suiteCtx = this._suite.particle;
		const suiteDir = path.dirname(suiteCtx.file);
		const appDirs = await this._ctx.builder.findApps({ suiteDir });
		if (!appDirs.length) {
			throw new Error('Application firmware is not found');
		}
		const appBin = await this._ctx.builder.buildApp({ appDir: appDirs[0], platform: suiteCtx.platform });
		await this._ctx.device.flash(appBin);
	}

	async _initDevices() {
		const particle = this._suite.particle;
		const platform = particle.platform;
		const dev = this._ctx.deviceManager.getDevice({ platform });
		this._log.verbose(`Target device: ${dev.displayName}`);
		await dev.init();
		this._ctx.device = dev;
		this._ctx.devices = [dev];
	}

	async _shutdownDevices() {
		for (let dev of this._ctx.devices) {
			await dev.shutdown();
			this._ctx.deviceManager.releaseDevice(dev);
		}
		delete this._ctx.devices;
		delete this._ctx.device;
	}
}
