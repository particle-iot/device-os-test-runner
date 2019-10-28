import { delay } from './util';

import fg from 'fast-glob';
import commondir from 'commondir';

import * as path from 'path';

const APP_SRC_GLOBS = [ '.c', '.cpp', '.cc', '.h', '.hpp', '.hh' ].map(ext => '**/*' + ext);

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
		this._initDevices();
		if (this._ctx.dryRun) {
			ctx.skip();
			return;
		}
		// Build and flash application binary
		const appBin = await this._buildApp();
		await this._ctx.device.flash(appBin);
	}

	async shutdown() {
		this._ctx.devices.forEach(dev => {
			this._ctx.deviceManager.releaseDevice(dev);
		});
		delete this._ctx.devices;
		delete this._ctx.device;
		this._ctx = null;
	}

	async runTest(test) {
		this._ctx.apiClient.setDevice(this._ctx.device);
		const name = test.title;
		await this._ctx.device.runTest(name);
	}

	async _buildApp() {
		const particle = this._suite.particle;
		const suiteDir = path.join(this._ctx.testDir, path.dirname(particle.file));
		let files = fg.sync(APP_SRC_GLOBS, {
			cwd: suiteDir,
			ignore: ['**/node_modules/**'],
			onlyFiles: true,
			absolute: true
		});
		if (!files.length) {
			throw new Error('Application source files not found');
		}
		const appDir = commondir(files);
		const appBin = await this._ctx.appBuilder.build({
			appDir,
			appName: path.basename(suiteDir),
			targetDir: path.relative(this._ctx.testDir, appDir),
			platform: particle.platform
		});
		return appBin;
	}

	_initDevices() {
		this._ctx.devices = [];
		const particle = this._suite.particle;
		const platform = particle.platform;
		this._ctx.device = this._ctx.deviceManager.getDevice({ platform });
		this._ctx.devices.push(this._ctx.device);
		this._log.verbose(`Target device: ${this._ctx.device.displayName}`);
	}
}
