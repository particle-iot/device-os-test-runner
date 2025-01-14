const { PlatformSuite } = require('./suite');
const { DeviceManager } = require('./device');
const { ApiClient } = require('./api');
const { Builder } = require('./build');
const { platformsForTag, isKnownPlatformTag, PLATFORMS, PLATFORM_TAGS, Platform } = require('./platform');
const { RunMode, OutputFormat, config, APP_NAME } = require('./config');
const { findTestName, shortenRight } = require('./util');
const { InternalError, isInternalError } = require('./error');
const globals = require('./globals');

const Mocha = require('mocha');
const glob = require('glob');
const mkdirp = require('mkdirp');
const tmp = require('tmp');

const fs = require('fs');
const path = require('path');

const DEFAULT_SYSTEM_MODES = ['semi-automatic'];
const DEFAULT_SYSTEM_THREAD_MODES = ['enabled', 'disabled'];
const DEFAULT_TEST_TIMEOUT = 10 * 60 * 1000;

const TEST_FILE_SUFFIX = '.spec.js';

const MochaTest = Mocha.Test;
const MochaSuite = Mocha.Suite;
const MochaRunner = Mocha.Runner;

function suiteDisplayName(name) {
	name = shortenRight(name, 30, '~');
	return `suite('${name}')`;
}

function testDisplayName(name) {
	name = shortenRight(name, 30, '~');
	return `test('${name}')`;
}

function formatJson(val) {
	return JSON.stringify(val, null, 2);
}

class Runner {
	constructor({ log }) {
		this._log = log; // Logger instance
		this._mocha = null; // Mocha instance
		this._devMgr = null; // Device manager
		this._apiClient = null; // API client
		this._builder = null; // Application builder
		this._enabledPlatforms = null; // Enabled platforms
		this._knownSuiteTags = null; // All known suite tags
		this._testFiles = null; // Test files
		this._testDir = null; // Test directory
		this._deviceOsDir = null; // Device OS directory
		this._binaryDir = null; // Firmware binaries directory
		this._tempDir = null; // Temp directory
		this._runMode = null; // Run mode
		this._patterns = null; // Test name patterns
		this._currentTest = null; // Current test
	}

	async init() {
		this._runMode = config.get('runMode');
		this._testDir = path.resolve(config.get('testDir'));
		this._log.verbose(`Test directory: ${this._testDir}`);
		this._deviceOsDir = config.get('deviceOsDir');
		if (this._deviceOsDir) {
			this._deviceOsDir = path.resolve(this._deviceOsDir);
			this._log.verbose(`Device OS directory: ${this._deviceOsDir}`);
		}
		this._binaryDir = config.get('binaryDir');
		if (!this._binaryDir && this._deviceOsDir) {
			const dir = path.join(this._deviceOsDir, 'build', 'integration'); // FIXME
			if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
				this._binaryDir = dir;
			}
		}
		if (this._binaryDir) {
			this._binaryDir = path.resolve(this._binaryDir);
			this._log.verbose(`Firmware binaries directory: ${this._binaryDir}`);
		}
		// Get enabled platforms
		const platforms = config.get('platforms');
		if (platforms.length) {
			this._enabledPlatforms = new Set();
			platforms.forEach(tag => {
				platformsForTag(tag).forEach(p => this._enabledPlatforms.add(p.id));
			});
		} else {
			this._enabledPlatforms = new Set(PLATFORMS.map(p => p.id)); // All platforms
		}
		// Create a temp directory
		this._tempDir = tmp.dirSync({
			prefix: APP_NAME + '-',
			unsafeCleanup: true // Remove the directory even if it's not empty
		});
		// Initialize application builder
		this._builder = new Builder({
			testDir: this._testDir,
			deviceOsDir: this._deviceOsDir,
			tempDir: this._tempDir.name,
			log: this._log
		});
		await this._builder.init();
		// Initialize Mocha
		this._mocha = new Mocha({
			ui: 'qunit',
			timeout: DEFAULT_TEST_TIMEOUT,
			slow: Number.MAX_SAFE_INTEGER, // "Disable" slow test warnings
			// fullStackTrace: true
		});
		// Load test files
		this._registerGlobals();
		this._loadTestFiles();
		this._applySuiteConfig();
		// Filter tests
		this._patterns = this._parsePatterns();
		const filters = this._parseFilters();
		this._applyFilters(filters);
	}

	async shutdown() {
		this._unregisterGlobals();
		this._mocha = null;
		if (this._devMgr) {
			await this._devMgr.shutdown();
			this._devMgr = null;
		}
		if (this._apiClient) {
			await this._apiClient.shutdown();
			this._apiClient = null;
		}
		if (this._builder) {
			await this._builder.shutdown();
			this._builder = null;
		}
		if (this._tempDir) {
			this._tempDir.removeCallback();
			this._tempDir = null;
		}
	}

	async run() {
		let ok = true;
		switch (this._runMode) {
			case RunMode.NORMAL:
			case RunMode.DRY_RUN: {
				ok = await this._run();
				break;
			}
			case RunMode.BUILD: {
				await this._build();
				break;
			}
			case RunMode.LIST_TESTS: {
				await this._listTests();
				break;
			}
			case RunMode.LIST_FIXTURES: {
				await this._listFixtures();
				break;
			}
			case RunMode.LIST_TAGS: {
				await this._listTags();
				break;
			}
			case RunMode.COMBINE_REPORTS: {
				await this._combineReports();
				break;
			}
			default: {
				throw new InternalError(`Invalid run mode: ${this._runMode}`);
			}
		}
		return ok;
	}

	get suites() {
		const rootSuite = this._mocha && this._mocha.suite;
		return rootSuite.suites;
	}

	get currentTest() {
		return this._currentTest;
	}

	async _run() {
		this._log.verbose('Initializing API client');
		this._apiClient = new ApiClient({
			log: this._log
		});
		await this._apiClient.init();
		this._log.verbose('Initializing device manager');
		this._devMgr = new DeviceManager({
			apiClient: this._apiClient,
			log: this._log
		});
		await this._devMgr.init(this._enabledPlatforms);
		this._log.verbose('Generating test matrix');
		await this._initTestMatrix();
		// Initialize the runner's context
		const ctx = this._mocha.suite.ctx;
		ctx.particle = {
			runner: this,
			deviceManager: this._devMgr,
			apiClient: this._apiClient,
			builder: this._builder,
			testDir: this._testDir,
			deviceOsDir: this._deviceOsDir,
			binaryDir: this._binaryDir,
			tempDir: this._tempDir.name,
			dryRun: this._runMode === RunMode.DRY_RUN,
			noFlash: config.get('noFlash'),
			log: this._log,
			// Convenience functions
			receiveEvent: (...args) => this._apiClient.receiveEvent(...args),
			addDeviceTests: (suite, tests) => this._addDeviceTests(suite, tests)
		};
		this._log.verbose('Running tests');
		return new Promise(resolve => {
			const runner = this._mocha.run(failureCount => {
				resolve(!failureCount);
			});
			this._initMochaRunner(runner);
		});
	}

	async _build() {
		if (!this._deviceOsDir) {
			throw new Error('Device OS directory is not specified');
		}
		let targetDir = config.get('targetDir');
		if (targetDir) {
			targetDir = path.resolve(targetDir);
		} else {
			targetDir = path.join(this._deviceOsDir, 'build', 'integration'); // FIXME
		}
		this._log.verbose(`Target directory: ${targetDir}`);
		const apps = [];
		const rootSuite = this._mocha.suite;
		for (const suite of rootSuite.suites) {
			const particle = suite.particle;
			if (!particle.exclude) {
				const suiteDir = path.dirname(particle.file);
				const appDirs = this._builder.findApps(suiteDir);
				for (const appDir of appDirs) {
					apps.push({ appDir, suiteDir, platforms: particle.platforms });
				}
			}
		}
		for (let i = 0; i < apps.length; ++i) {
			const appDir = apps[i].appDir;
			const suiteDir = apps[i].suiteDir;
			const platformNames = apps[i].platforms.map(p => p.name).join(', ');
			console.log(`Building application: ${appDir}`);
			console.log(`Platforms: ${platformNames}`);
			for (const platform of apps[i].platforms) {
				const srcBin = await this._builder.buildApp({ appDir, platform });
				const destDir = path.join(targetDir, platform.name, suiteDir);
				const destBin = path.join(destDir, path.basename(srcBin));
				mkdirp.sync(destDir);
				fs.copyFileSync(srcBin, destBin);
			}
			if (i !== apps.length - 1) {
				console.log();
			}
		}
	}

	async _listTests() {
		const suites = [];
		const rootSuite = this._mocha.suite;
		for (const suite of rootSuite.suites) {
			const particle = suite.particle;
			if (particle.exclude) {
				continue;
			}
			let fixtures = new Set(particle.fixtures.map(f => f.name));
			fixtures = Array.from(fixtures.values()).sort();
			suites.push({
				name: suite.title,
				file: particle.file,
				platforms: particle.platforms.map(p => p.name),
				fixtures,
				systemThreadModes: particle.systemThreadModes,
				systemModes: particle.systemModes,
				tags: particle.tags,
				tests: suite.tests.map(test => ({
					name: test.title
				}))
			});
		}
		if (config.get('outputFormat') === OutputFormat.JSON) {
			console.log(formatJson({ suites }));
		} else {
			const lines = suites.map(suite => {
				const lines = [];
				const padding = 15;
				lines.push('suite:'.padEnd(padding) + suite.name);
				lines.push('file:'.padEnd(padding) + suite.file);
				if (suite.tags.length) {
					lines.push('tags:'.padEnd(padding) + suite.tags.join(', '));
				}
				lines.push('platforms:'.padEnd(padding) + suite.platforms.join(', '));
				if (suite.fixtures.length) {
					lines.push('fixtures:'.padEnd(padding) + suite.fixtures.join(', '));
				}
				lines.push('system thread:'.padEnd(padding) + suite.systemThreadModes.join(', '));
				lines.push('system mode:'.padEnd(padding) + suite.systemModes.join(', '));
				if (suite.tests.length) {
					lines.push('tests:'.padEnd(padding) + suite.tests[0].name);
					for (let i = 1; i < suite.tests.length; ++i) {
						lines.push(' '.repeat(padding) + suite.tests[i].name);
					}
				}
				return lines.join('\n');
			});
			if (lines.length) {
				console.log(lines.join('\n\n'));
			}
		}
	}

	async _listFixtures() {
		let fixtures = new Set();
		const rootSuite = this._mocha.suite;
		for (const suite of rootSuite.suites) {
			const particle = suite.particle;
			if (!particle.exclude) {
				particle.fixtures.forEach(f => fixtures.add(f.name));
			}
		}
		fixtures = Array.from(fixtures.values()).sort();
		if (config.get('outputFormat') === OutputFormat.JSON) {
			fixtures = fixtures.map(f => ({ name: f }));
			console.log(formatJson({ fixtures }));
		} else if (fixtures.length) {
			console.log(fixtures.join('\n'));
		}
	}

	async _listTags() {
		// Combine platform and suite tags
		let tags = new Set([...this._knownSuiteTags, ...PLATFORM_TAGS]);
		tags = Array.from(tags.values()).sort();
		if (config.get('outputFormat') === OutputFormat.JSON) {
			console.log(formatJson({ tags }));
		} else if (tags.length) {
			console.log(tags.join('\n'));
		}
	}

	async _combineReports() {
		// TODO
		throw new Error('Not implemented');
	}

	_initMochaRunner(runner) {
		const suiteBegin = () => {
			this._log.indent();
		};
		const suiteEnd = () => {
			this._log.unindent();
		};
		const testBegin = (test) => {
			this._currentTest = test;
			this._log.indent();
			test.particle.startTime = Date.now();
		};
		const testEnd = () => {
			this._log.unindent();
			this._currentTest = null;
		};
		const testPass = (test) => {
			// Print test duration for all passed tests
			let dt = Date.now() - test.particle.startTime - (test.particle.suiteInitDuration || 0);
			if (dt >= 1000) {
				dt = Math.round(dt / 100) / 10;
				let s = test.title;
				if (s.trim().endsWith(')')) {
					const i = s.lastIndexOf(')');
					s = s.slice(0, i).trim() + '; ';
				} else {
					s = s.trim() + ' (';
				}
				s += `${dt}s)`;
				test.title = s;
			}
		};
		const runEnd = () => {
			runner.off(MochaRunner.constants.EVENT_SUITE_BEGIN, suiteBegin);
			runner.off(MochaRunner.constants.EVENT_SUITE_END, suiteEnd);
			runner.off(MochaRunner.constants.EVENT_TEST_BEGIN, testBegin);
			runner.off(MochaRunner.constants.EVENT_TEST_END, testEnd);
			runner.off(MochaRunner.constants.EVENT_TEST_PASS, testPass);
		};
		runner.on(MochaRunner.constants.EVENT_SUITE_BEGIN, suiteBegin);
		runner.on(MochaRunner.constants.EVENT_SUITE_END, suiteEnd);
		runner.on(MochaRunner.constants.EVENT_TEST_BEGIN, testBegin);
		runner.on(MochaRunner.constants.EVENT_TEST_END, testEnd);
		runner.prependListener(MochaRunner.constants.EVENT_TEST_PASS, testPass);
		runner.once(MochaRunner.constants.EVENT_RUN_END, runEnd);
	}

	async _initTestMatrix() {
		const suites = [];
		const rootSuite = this._mocha.suite;
		for (const srcSuite of rootSuite.suites) {
			const particle = srcSuite.particle;
			if (particle.exclude) {
				continue;
			}
			const file = particle.file;
			const newSuite = srcSuite.clone(); // Doesn't copy tests and hooks
			let platformsByFixture = this._devMgr.getPlatformsForFixtures(particle.fixtures);
			let platforms = particle.platforms;
			if (platformsByFixture && platformsByFixture.length > 1) {
				// Mixed platforms
				platformsByFixture = platforms.filter((v) => platformsByFixture.includes(v.id));
				platforms = platformsByFixture;
				let fakeId = 0;
				const fakeName = platforms.map((v) => v.name).join('/');
				const fakeDisplayName = platforms.map((v) => v.displayName).join(' / ');
				const fakeTags = [... platforms.map((v) => v.tags)].flat(1);
				for (let i = 0; i < platforms.length; i++) {
					fakeId += platforms[i].id * (100 ** (i));
				}
				platforms = [new Platform({ id: fakeId, name: fakeName, displayName: fakeDisplayName, tags: fakeTags })];
				// FIXME
				platforms[0].mixed = true;
				platforms[0].platforms = platformsByFixture;
			} else if (platformsByFixture.length === 1) {
				platforms = platforms.filter((v) => platformsByFixture.includes(v.id));
			}

			// Create a nested suite for each platform
			for (const platform of platforms) {
				const platformSuite = MochaSuite.create(newSuite, platform.name);
				platformSuite.particle = {
					platform,
					fixtures: particle.fixtures,
					file
				};
				const suiteWrapper = this._initPlatformSuite(platformSuite);
				// Create a nested suite for each combination of the remaining parameters
				for (const systemThread of particle.systemThreadModes) {
					for (const systemMode of particle.systemModes) {
						const params = [];
						params.push(`systemThread=${systemThread}`);
						// System mode is hidden by default
						if (!particle.hasDefaultSystemModes) {
							params.push(`systemMode=${systemMode}`);
						}
						const title = params.join(', ');
						const suite = MochaSuite.create(platformSuite, title);
						suite.particle = {
							platform,
							systemThread,
							systemMode,
							file
						};
						suite.beforeEach(async function hook() {
							try {
								this.timeout(Number.MAX_SAFE_INTEGER);
								await suiteWrapper.runTest(this.currentTest);
							} catch (e) {
								// An exception thrown from a beforeEach() hook prevents all other tests from running
								if (!isInternalError(e)) {
									delete e.stack;
								}
								this.currentTest.fn = () => Promise.reject(e);
							}
						});
						// Copy tests
						for (const srcTest of srcSuite.tests) {
							if (!this._matchesPatterns(srcTest.title)) {
								continue;
							}
							const test = srcTest.clone();
							test.particle = {};
							suite.addTest(test);
						}
						if (!suite.tests.length) {
							// Add a dummy test to force Mocha to run hooks
							const test = new MochaTest('', () => {});
							suite.addTest(test);
						}
						// Copy hooks
						for (const hook of srcSuite.getHooks(MochaSuite.constants.HOOK_TYPE_BEFORE_ALL)) {
							suite.beforeAll(hook.fn);
						}
						for (const hook of srcSuite.getHooks(MochaSuite.constants.HOOK_TYPE_AFTER_ALL)) {
							suite.afterAll(hook.fn);
						}
						for (const hook of srcSuite.getHooks(MochaSuite.constants.HOOK_TYPE_BEFORE_EACH)) {
							suite.beforeEach(hook.fn);
						}
						for (const hook of srcSuite.getHooks(MochaSuite.constants.HOOK_TYPE_AFTER_EACH)) {
							suite.afterEach(hook.fn);
						}
					}
				}
			}
			for (const suite of srcSuite.suites) {
				const name = suiteDisplayName(suite.title);
				this._log.warn(`${file}: ${name}: Nested suites are not supported`);
			}
			suites.push(newSuite);
		}
		// Replace original suites
		rootSuite.suites = suites;
	}

	_addDeviceTests(platformSuite, deviceTests) {
		// Index device tests by name
		deviceTests = deviceTests.reduce((map, t) => {
			for (const test of t.tests) {
				if (!this._matchesPatterns(test)) {
					continue;
				}
				let devs = map.get(test);
				if (!devs) {
					devs = [];
					map.set(test, devs);
				}
				devs.push(t.device);
			}
			return map;
		}, new Map());
		// Assign devices to the tests defined in the spec file
		const specTests = new Set();
		for (const suite of platformSuite.suites) {
			const tests = suite.tests;
			if (tests.length === 1 && !tests[0].title) {
				tests.shift(); // Remove dummy test
			}
			for (const test of tests) {
				const testName = findTestName(deviceTests, test.title);
				if (testName) {
					// This test has its on-device counterpart
					test.particle.devices = deviceTests.get(testName);
					test.particle.deviceTestName = testName;
					specTests.add(testName);
				}
			}
		}
		// Add device-only tests
		specTests.forEach(t => deviceTests.delete(t));
		const testNames = Array.from(deviceTests.keys()).sort();
		for (const suite of platformSuite.suites) {
			for (const testName of testNames) {
				const test = new MochaTest(testName, () => {});
				test.particle = {
					devices: deviceTests.get(testName),
					deviceTestName: testName
				};
				suite.addTest(test);
			}
		}
	}

	_initPlatformSuite(suite) {
		const wrapper = new PlatformSuite({ suite, log: this._log });
		suite.beforeAll(async function hook() {
			try {
				await wrapper.init(this); // Forward the context object to the wrapper
			} catch (e) {
				// Suite initialization errors are usually caused by a misconfiguration, and their stack
				// traces are not informative for end users
				if (!config.get('verbose') && !isInternalError(e)) {
					delete e.stack;
				}
				throw e;
			}
		});
		suite.afterAll(async function hook() {
			await wrapper.shutdown();
		});
		// Give descriptive names to the hooks
		let hooks = suite.getHooks(MochaSuite.constants.HOOK_TYPE_BEFORE_ALL);
		hooks[hooks.length - 1].title = 'suite initialization';
		hooks = suite.getHooks(MochaSuite.constants.HOOK_TYPE_AFTER_ALL);
		hooks[hooks.length - 1].title = 'suite deinitialization';
		return wrapper;
	}

	_applyFilters(filters) {
		const rootSuite = this._mocha.suite;
		for (const suite of rootSuite.suites) {
			const particle = suite.particle;
			let fileMatch = true;
			if (filters.files) {
				fileMatch = filters.files.has(particle.file);
			}
			let platformMatch = true;
			if (filters.platforms) {
				particle.platforms = particle.platforms.filter(p => filters.platforms.has(p.id));
				if (!particle.platforms.length) {
					platformMatch = false;
				}
			}
			let suiteTagMatch = true;
			if (filters.suiteTags) {
				if (!particle.tags.length) {
					suiteTagMatch = filters.includeUntaggedSuites;
				} else {
					suiteTagMatch = particle.tags.some(tag => filters.suiteTags.has(tag));
				}
			}
			particle.exclude = !(fileMatch && platformMatch && suiteTagMatch);
		}
		if (filters.platforms) {
			this._enabledPlatforms = filters.platforms;
		}
	}

	_parseFilters() {
		let files = null;
		const updateFiles = (fs, exclude) => {
			if (exclude) {
				if (!files) {
					files = new Set(this._testFiles); // All test files
				}
				fs.forEach(file => files.delete(file));
			} else {
				if (!files) {
					files = new Set();
				}
				fs.forEach(file => files.add(file));
			}
		};
		let platforms = null;
		const updatePlatforms = (tag, exclude) => {
			if (exclude) {
				if (!platforms) {
					platforms = new Set(this._enabledPlatforms); // All enabled platforms
				}
				platformsForTag(tag).forEach(p => platforms.delete(p.id));
			} else {
				if (!platforms) {
					platforms = new Set();
				}
				platformsForTag(tag).forEach(p => platforms.add(p.id));
			}
		};
		let suiteTags = null;
		let includeUntaggedSuites = false;
		const updateSuiteTags = (tag, exclude) => {
			if (exclude) {
				if (!suiteTags) {
					suiteTags = new Set(this._knownSuiteTags); // All suite tags
					includeUntaggedSuites = true;
				}
				suiteTags.delete(tag);
			} else {
				if (!suiteTags) {
					suiteTags = new Set();
				}
				suiteTags.add(tag);
			}
		};
		// Parse filters
		const filters = config.get('filters');
		for (let f of filters) {
			let exclude = false;
			if (f.startsWith('-')) {
				f = f.substring(1);
				exclude = true;
			}
			if (f.endsWith(TEST_FILE_SUFFIX)) { // Test file
				const files = this._findTestFiles(f);
				if (!files.length) {
					throw new Error(`File not found: ${f}`);
				}
				updateFiles(files, exclude);
			} else if (f.indexOf('/') !== -1) { // Test directory
				if (f.endsWith('/')) {
					f = f.substring(0, f.length - 1);
				}
				const files = this._findTestFiles(f + '/**/*' + TEST_FILE_SUFFIX);
				if (!files.length) {
					throw new Error(`Directory not found: ${f}`);
				}
				updateFiles(files, exclude);
			} else if (this._knownSuiteTags.has(f)) { // Suite tag
				updateSuiteTags(f, exclude);
			} else if (isKnownPlatformTag(f)) { // Platform tag
				updatePlatforms(f, exclude);
			} else {
				const files = this._findTestFiles(f + '/**/*' + TEST_FILE_SUFFIX);
				if (files.length) { // Test directory
					updateFiles(files, exclude);
				} else {
					throw new Error(`Unrecognized filtering option: ${f}`);
				}
			}
		}
		return {
			files,
			platforms,
			suiteTags,
			includeUntaggedSuites
		};
	}

	_matchesPatterns(str) {
		if (!this._patterns.length) {
			return true;
		}
		for (const p of this._patterns) {
			if (p instanceof RegExp) {
				if (str.match(p)) {
					return true;
				}
			} else if (str === p) {
				return true;
			}
		}
		return false;
	}

	_parsePatterns() {
		const patterns = config.get('patterns');
		for (let i = 0; i < patterns.length; ++i) {
			try {
				const rx = new RegExp(patterns[i]);
				patterns[i] = rx;
			} catch (err) {
				// Ignore error
			}
		}
		return patterns;
	}

	_applySuiteConfig() {
		this._knownSuiteTags = new Set();
		const rootSuite = this._mocha.suite;
		for (const test of rootSuite.tests) {
			const file = path.relative(this._testDir, test.file);
			const name = testDisplayName(test.title);
			this._log.warn(`${file}: ${name}: Test case is defined outside of a test suite`);
		}
		for (const suite of rootSuite.suites) {
			const particle = suite.particle;
			const config = particle.config || {};
			// Target platforms
			if (config.platforms && config.platforms.size) {
				particle.platforms = Array.from(config.platforms.values());
			} else {
				const name = suiteDisplayName(suite.title);
				this._log.warn(`${particle.file}: ${name}: Target platform is not specified`);
				particle.platforms = PLATFORMS; // Run on all platforms
			}
			particle.platforms.sort((p1, p2) => p1.id - p2.id); // Sort platforms by ID
			// Fixtures
			if (config.fixtures && config.fixtures.length) {
				particle.fixtures = config.fixtures;
			} else {
				particle.fixtures = [];
			}
			// System thread modes
			if (config.systemThreadModes && config.systemThreadModes.size) {
				particle.systemThreadModes = Array.from(config.systemThreadModes.values());
			} else {
				particle.systemThreadModes = DEFAULT_SYSTEM_THREAD_MODES;
			}
			particle.systemThreadModes.sort();
			// System modes
			if (config.systemModes && config.systemModes.size) {
				particle.systemModes = Array.from(config.systemModes.values());
				particle.hasDefaultSystemModes = false;
			} else {
				particle.systemModes = DEFAULT_SYSTEM_MODES;
				particle.hasDefaultSystemModes = true;
			}
			particle.systemModes.sort();
			// Suite tags
			if (config.tags) {
				particle.tags = Array.from(config.tags.values());
				particle.tags.forEach(tag => this._knownSuiteTags.add(tag));
				particle.tags.sort();
			} else {
				particle.tags = [];
			}
			// Default timeout
			if (config.timeout !== undefined) {
				suite.timeout(config.timeout);
			}
			delete particle.config;
		}
	}

	_loadTestFiles() {
		let originalSuiteFn = null;
		// This function creates a wrapper for the Mocha's describe() function. The wrapper forwards
		// its arguments to the original function and stores a reference to the newly created suite
		// in the global context object. This can also be done via the Suite's EVENT_SUITE_ADD_SUITE
		// event, but it's marked as deprecated in the reference docs
		const createSuiteFn = (ctx, fn) => function createSuite(...args) {
			const suite = fn(...args);
			suite.particle = {
				file: ctx.particle.currentFile
			};
			ctx.particle.currentSuite = suite;
			return suite;
		};
		const preRequire = (ctx, file) => {
			this._log.debug(`Loading file: ${file}`);
			if (!ctx.suite) { // Used in TDD/QUnit
				throw new InternalError('Unsupported test interface');
			}
			ctx.particle = {
				currentFile: path.relative(this._testDir, file)
			};
			originalSuiteFn = ctx.suite;
			ctx.suite = createSuiteFn(ctx, ctx.suite);
		};
		const postRequire = (ctx) => {
			// Restore the context
			if (ctx.suite) {
				ctx.suite = originalSuiteFn;
			}
			delete ctx.particle.currentFile;
			delete ctx.particle.currentSuite;
		};
		// Get the list of test files
		this._testFiles = this._findTestFiles('**/*' + TEST_FILE_SUFFIX);
		if (!this._testFiles.length) {
			throw new Error('No test files found');
		}
		this._testFiles.sort();
		this._testFiles.forEach(file => {
			this._mocha.addFile(path.join(this._testDir, file));
		});
		// Load test files
		this._mocha.suite.on(MochaSuite.constants.EVENT_FILE_PRE_REQUIRE, preRequire);
		this._mocha.suite.on(MochaSuite.constants.EVENT_FILE_POST_REQUIRE, postRequire);
		this._mocha.loadFiles();
		this._mocha.suite.off(MochaSuite.constants.EVENT_FILE_PRE_REQUIRE, preRequire);
		this._mocha.suite.off(MochaSuite.constants.EVENT_FILE_POST_REQUIRE, postRequire);
	}

	_findTestFiles(pattern) {
		return glob.sync(pattern, {
			cwd: this._testDir,
			ignore: ['**/node_modules/**'],
			nodir: true
		});
	}

	_registerGlobals() {
		global.particle = {};
		for (const name in globals) {
			if (name in global) {
				throw new InternalError(`Name of a global is already in use: ${name}`);
			}
			global[name] = globals[name];
		}
	}

	_unregisterGlobals() {
		for (const name in globals) {
			delete global[name];
		}
		delete global.particle;
	}
}

module.exports = {
	Runner
};
