import { execCommand } from './util';

import fg from 'fast-glob';

import * as path from 'path';

/**
 * Wrapper class for a Mocha suite.
 */
export class PlatformSuite {
	constructor({ suite, log }) {
		this._log = log; // Logger instance
		this._suite = suite; // Test suite
		this._tests = null; // Device tests
		this._ctx = null; // Runner context
	}

	async init(ctx) {
		this._ctx = ctx.particle;
		await this._initDevices();
		if (this._ctx.dryRun) {
			ctx.skip();
			return;
		}
		// Build and flash application binary
		const appBin = await this._buildApp();
		await this._ctx.device.flash(appBin);
		// Get the list of on-device tests
		const tests = await this._ctx.device.getTests();
		this._tests = new Set(tests);
	}

	async shutdown() {
		await this._shutdownDevices();
		this._ctx = null;
	}

	async runTest(test) {
		let name = test.title;
		if (!this._tests.has(name)) {
			name = name.replace(/\W+/g, '_');
			if (!this._tests.has(name)) {
				name = name.toLowerCase();
				if (!this._tests.has(name)) {
					throw new Error(`Device test not found: ${test.title}`);
				}
			}
		}
		this._ctx.apiClient.setDevice(this._ctx.device); // FIXME
		await this._ctx.device.runTest(name);
	}

	async _buildApp() {
		const particle = this._suite.particle;
		const testDir = path.dirname(particle.file);
		this._log.verbose(`Building test application: ${testDir}`);
		if (!this._ctx.deviceOsDir) {
			throw new Error('Device OS directory not found');
		}
		const platformName = particle.platform.name;
		const targetDir = path.join(this._ctx.tempDir, 'build', platformName, testDir);
		const cmd = 'make';
		const args = ['-s', 'all', `PLATFORM=${platformName}`, `TEST=integration/${testDir}`, `TARGET_DIR=${targetDir}`];
		const cwd = path.join(this._ctx.deviceOsDir, 'main');
		this._log.verbose(`Running command: ${cmd} ${args.join(' ')}`);
		const result = await execCommand(cmd, args, cwd);
		if (result.code !== 0) {
			throw new Error(`\`${cmd}\` failed with the exit code ${result.code}:\n${result.stdout}`);
		}
		// Find application binary
		const binFiles = fg.sync('*.bin', {
			cwd: targetDir,
			onlyFiles: true,
			absolute: true
		});
		if (binFiles.length !== 1) {
			throw new Error('Application binary not found');
		}
		return binFiles[0];
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
