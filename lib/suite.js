const { TestResult } = require('./device');
const { delay } = require('./util');

const glob = require('glob');

const path = require('path');

class DeviceLog {
	constructor({ name, log }) {
		this._name = name;
		this._log = log;
	}

	error(...args) {
		this._log.error(this._name + ':', ...args);
	}

	warn(...args) {
		this._log.warn(this._name + ':', ...args);
	}

	info(...args) {
		this._log.info(this._name + ':', ...args);
	}

	verbose(...args) {
		this._log.verbose(this._name + ':', ...args);
	}

	debug(...args) {
		this._log.debug(this._name + ':', ...args);
	}

	silly(...args) {
		this._log.silly(this._name + ':', ...args);
	}
}

class DeviceTestError extends Error {
	constructor(msg) {
		super(msg);
		this.name = this.constructor.name;
	}
}

/**
 * Wrapper class for a Mocha suite.
 */
class PlatformSuite {
	constructor({ suite, log }) {
		this._log = log; // Logger instance
		this._suite = suite; // Test suite
		this._ctx = null; // Runner context
		this._onDeviceReset = this._onDeviceReset.bind(this);
	}

	async init(ctx) {
		this._ctx = ctx.particle;
		// Initialize devices under test
		await this._initDevices();
		if (!this._ctx.dryRun) {
			// Build and flash application binaries
			await this._flashApps();
			// Add device tests to the suite
			await this._updateTests();
		} else {
			ctx.skip();
		}
	}

	async shutdown() {
		if (this._ctx) {
			await this._shutdownDevices();
			this._ctx.apiClient.resetTestDevices(); // FIXME
			this._ctx = null;
		}
	}

	async runTest(test) {
		const devs = test.particle.devices;
		if (!devs || !devs.length) {
			// This is a standalone JavaScript test
			return;
		}
		this._ctx.apiClient.setTestDevices(this._ctx.devices); // FIXME
		const activeDevs = new Map();
		try {
			// Mark all target devices as active
			for (const dev of devs) {
				activeDevs.set(dev.id, dev);
			}
			// Initialize test suite on each device
			test.particle.suiteInitDuration = 0;
			if (!test.parent.particle.suiteInitialized) {
				for (const dev of devs) {
					this._deviceLog(dev).verbose('Initializing device test suite');
					// Clear the application backup RAM when initializing the test suite for the first time
					const param = { ...test.parent.particle, clearBackupMemory: !test.parent.particle.backupMemoryCleared };
					const t1 = Date.now();
					await dev.initSuite(param);
					test.particle.suiteInitDuration += Date.now() - t1;
				}
				test.parent.particle.backupMemoryCleared = true;
				test.parent.particle.suiteInitialized = true;
			}
			// Start the test on each device
			const testName = test.particle.deviceTestName;
			for (const dev of devs) {
				this._deviceLog(dev).verbose(`Running device test: ${testName}`);
				await dev.startTest(testName);
			}
			// Wait until the test completes
			const ps = devs.map(async (dev) => {
				const r = await dev.waitTest({ timeout: this._suite.timeout() });
				activeDevs.delete(dev.id);
				dev.mailBox = r.mailBox;
				if (r.result === TestResult.PASSED) {
					this._deviceLog(dev).verbose('Device test passed');
				} else if (r.result === TestResult.SKIPPED) {
					this._deviceLog(dev).verbose('Device test skipped');
					// TODO: Mark the current test as skipped
				} else {
					const msg = r.log || 'Device test failed';
					this._deviceLog(dev).error(msg);
					throw new DeviceTestError(msg);
				}
			});
			await Promise.all(ps);
		} catch (e) {
			if (!(e instanceof DeviceTestError)) {
				this._log.error(e.message);
				test.parent.particle.suiteInitialized = false;
			}
			if (activeDevs.size) {
				// When one of the devices running a fixture-based test fails, there's no guarantee that all other
				// devices will finish running their tests in a timely manner. As a workaround, we reset them
				await delay(1000);
				const ps = Array.from(activeDevs.values()).map(dev => {
					this._deviceLog(dev).warn('Resetting device');
					return dev.reset().catch(e => {
						this._deviceLog(dev).warn(`Error while resetting device: ${e.message}`);
					});
				});
				await Promise.all(ps);
				test.parent.particle.suiteInitialized = false;
			}
			throw e;
		}
	}

	async _updateTests() {
		const tests = [];
		for (const dev of this._ctx.devices) {
			this._deviceLog(dev).verbose('Getting device tests');
			const testNames = await dev.getTests();
			tests.push({
				device: dev,
				tests: testNames
			});
		}
		this._ctx.addDeviceTests(this._suite, tests);
	}

	async _flashApps() {
		const particle = this._suite.particle;
		const suiteDir = path.dirname(particle.file);
		const platform = particle.platform;
		const apps = new Map();
		// Find precompiled binaries
		if (this._ctx.binaryDir) {
			const files = glob.sync('**/*.bin', {
				cwd: path.join(this._ctx.binaryDir, platform.name, suiteDir),
				nodir: true,
				absolute: true
			});
			files.forEach(file => {
				const appName = path.basename(file, '.bin');
				apps.set(appName, { path: file, build: false });
			});
		}
		// Find application sources
		const appDirs = this._ctx.builder.findApps(suiteDir);
		for (const appDir of appDirs) {
			const appName = path.basename(appDir);
			if (!apps.has(appName)) {
				apps.set(appName, { path: appDir, build: true });
			}
		}
		// Determine which application should be flashed to which device
		const devApps = [];
		const defaultAppName = path.basename(suiteDir);
		for (const dev of this._ctx.devices) {
			let appName = null;
			const fixture = this._ctx.fixtures.get(dev.id);
			if (fixture) {
				if (fixture.app) {
					appName = fixture.app;
				} else if (apps.has(fixture.name)) {
					appName = fixture.name;
				}
			} else if (apps.size === 1) {
				appName = apps.keys().next().value;
			}
			if (!appName) {
				appName = defaultAppName;
			}
			const app = apps.get(appName);
			if (!app) {
				throw new Error(`Application not found: ${appName}`);
			}
			devApps.push({ dev, app });
		}
		// Build applications
		for (const devApp of devApps) {
			const app = devApp.app;
			if (app.build) {
				this._log.verbose(`Building application: ${app.path}`);
				app.path = await this._ctx.builder.buildApp({ appDir: app.path, platform });
				app.build = false;
			}
		}
		// Flash applications
		let error = null;
		const ps = devApps.map(async ({ dev, app }) => {
			try {
				const fileName = path.basename(app.path);
				this._deviceLog(dev).verbose(`Flashing application: ${fileName}`);
				await dev.flash(app.path);
				dev.setTestAppBinFile(app.path);
			} catch (err) {
				this._deviceLog(dev).error(`Error while flashing application: ${err.message}`);
				if (!error) {
					error = err;
				}
			}
		});
		await Promise.all(ps);
		if (error) {
			// Reset all devices
			const ps = this._ctx.devices.map(dev => {
				this._deviceLog(dev).warn('Resetting device');
				return dev.reset().catch(e => {
					this._deviceLog(dev).warn(`Error while resetting device: ${e.message}`);
				});
			});
			await Promise.all(ps);
			throw error;
		}
	}

	async _initDevices() {
		this._ctx.devices = [];
		this._ctx.fixtures = new Map();
		const particle = this._suite.particle;
		const platform = particle.platform;
		const fixtures = particle.fixtures;
		if (fixtures.length) {
			for (const fixture of fixtures) {
				const dev = this._ctx.deviceManager.getDevice({ fixture: fixture.name, platform });
				this._ctx.devices.push(dev);
				this._ctx.fixtures.set(dev.id, fixture);
				this._deviceLog(dev).verbose(`Target device: ${dev.displayName}`);
			}
		} else {
			const dev = this._ctx.deviceManager.getDevice({ platform });
			this._ctx.devices.push(dev);
			this._deviceLog(dev).verbose(`Target device: ${dev.displayName}`);
		}
		for (const dev of this._ctx.devices) {
			dev.on('reset', this._onDeviceReset);
		}
	}

	async _shutdownDevices() {
		if (this._ctx.devices) {
			for (const dev of this._ctx.devices) {
				dev.off('reset', this._onDeviceReset);
				try {
					this._deviceLog(dev).verbose('Resetting device');
					await dev.reset();
				} catch (e) {
					this._deviceLog(dev).warn(`Error while resetting device: ${e.message}`);
				}
				await dev.close();
				this._ctx.deviceManager.releaseDevice(dev);
			}
			delete this._ctx.devices;
		}
		delete this._ctx.fixtures;
	}

	_onDeviceReset() {
		const test = this._ctx.runner.currentTest;
		if (test) {
			test.parent.particle.suiteInitialized = false; // TODO: This should be a per-device flag
		}
	}

	_deviceLog(dev) {
		if (this._ctx && this._ctx.fixtures) {
			const f = this._ctx.fixtures.get(dev.id);
			if (f) {
				return new DeviceLog({ name: f.name, log: this._log }); // FIXME
			}
		}
		return this._log;
	}
}

module.exports = {
	PlatformSuite
};
