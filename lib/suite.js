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
		const testDir = path.dirname(particle.file);
		this._log.verbose(`Building test application: ${testDir}`);
		if (!this._ctx.deviceOsDir) {
			throw new Error('Device OS directory not found');
		}
		const platformName = particle.platform.name;
		const targetDir = path.join(this._ctx.tempDir, 'build', testDir, platformName);
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

	_initDevices() {
		this._ctx.devices = [];
		const particle = this._suite.particle;
		const platform = particle.platform;
		this._ctx.device = this._ctx.deviceManager.getDevice({ platform });
		this._ctx.devices.push(this._ctx.device);
		this._log.verbose(`Target device: ${this._ctx.device.displayName}`);
	}
}
