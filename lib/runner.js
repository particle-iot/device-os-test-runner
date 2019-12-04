import { PlatformSuite } from './suite';
import { DeviceManager } from './device';
import { ApiClient } from './api';
import { platformsForTag, isKnownPlatformTag, PLATFORMS, PLATFORM_TAGS } from './platform';
import { RunMode, OutputFormat, config, APP_NAME } from './config';
import { findTestName, shortenRight } from './util';
import { InternalError, isInternalError } from './error';
import * as globals from './globals';

import Mocha from 'mocha';
import chalk from 'chalk';
import fg from 'fast-glob';
import tmp from 'tmp';

import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_SYSTEM_MODES = ['semi-automatic'];
const DEFAULT_SYSTEM_THREAD_MODES = ['disabled', 'enabled'];
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

export class Runner {
	constructor({ log }) {
		this._log = log; // Logger instance
		this._mocha = null; // Mocha instance
		this._devMgr = null; // Device manager
		this._apiClient = null; // API client
		this._enabledPlatforms = null; // Enabled platforms
		this._knownSuiteTags = null; // All known suite tags
		this._testFiles = null; // Test files
		this._testDir = null; // Test directory
		this._deviceOsDir = null; // Device OS directory
		this._tempDir = null; // Temporary directory
		this._runMode = null; // Run mode
	}

	async init() {
		this._runMode = config.get('runMode');
		this._deviceOsDir = config.get('deviceOsDir');
		if (this._deviceOsDir) {
			this._deviceOsDir = path.resolve(this._deviceOsDir);
			this._log.verbose(`Device OS directory: ${this._deviceOsDir}`);
		}
		this._testDir = path.resolve(config.get('testDir'));
		this._log.verbose(`Test directory: ${this._testDir}`);
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
			default: {
				throw new InternalError(`Invalid run mode: ${this._runMode}`);
			}
		}
		return ok;
	}

	async _run() {
		this._log.verbose('Generating test matrix');
		this._initTestMatrix();
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
		// Create a temporary directory
		this._tempDir = tmp.dirSync({
			prefix: APP_NAME + '-',
			unsafeCleanup: true // Remove the directory even if it's not empty
		});
		// Initialize the runner's context
		const ctx = this._mocha.suite.ctx;
		ctx.particle = {
			deviceManager: this._devMgr,
			apiClient: this._apiClient,
			testDir: this._testDir,
			deviceOsDir: this._deviceOsDir,
			tempDir: this._tempDir.name,
			dryRun: this._runMode === RunMode.DRY_RUN,
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
		throw new InternalError('Not implemented');
	}

	async _listTests() {
		const suites = [];
		const rootSuite = this._mocha.suite;
		for (let suite of rootSuite.suites) {
			const particle = suite.particle;
			if (particle.exclude) {
				continue;
			}
			suites.push({
				name: suite.title,
				file: particle.file,
				platforms: particle.platforms.map(p => p.name),
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
				lines.push('platforms:'.padEnd(padding) + suite.platforms.join(', '));
				lines.push('system thread:'.padEnd(padding) + suite.systemThreadModes.join(', '));
				lines.push('system mode:'.padEnd(padding) + suite.systemModes.join(', '));
				if (suite.tags.length) {
					lines.push('tags:'.padEnd(padding) + suite.tags.join(', '));
				}
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
		throw new InternalError('Not implemented');
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

	_initMochaRunner(runner) {
		const suiteBegin = (suite) => {
			this._log.indent();
		};
		const suiteEnd = (suite) => {
			this._log.unindent();
		};
		const testBegin = (test) => {
			this._log.indent();
		};
		const testEnd = (test) => {
			this._log.unindent();
		};
		const runEnd = () => {
			runner.off(MochaRunner.constants.EVENT_SUITE_BEGIN, suiteBegin);
			runner.off(MochaRunner.constants.EVENT_SUITE_END, suiteEnd);
			runner.off(MochaRunner.constants.EVENT_TEST_BEGIN, testBegin);
			runner.off(MochaRunner.constants.EVENT_TEST_END, testEnd);
			runner.off(MochaRunner.constants.EVENT_RUN_END, runEnd);
		};
		runner.on(MochaRunner.constants.EVENT_SUITE_BEGIN, suiteBegin);
		runner.on(MochaRunner.constants.EVENT_SUITE_END, suiteEnd);
		runner.on(MochaRunner.constants.EVENT_TEST_BEGIN, testBegin);
		runner.on(MochaRunner.constants.EVENT_TEST_END, testEnd);
		runner.on(MochaRunner.constants.EVENT_RUN_END, runEnd);
	}

	_initTestMatrix() {
		let suites = [];
		const rootSuite = this._mocha.suite;
		for (let srcSuite of rootSuite.suites) {
			const particle = srcSuite.particle;
			if (particle.exclude) {
				continue;
			}
			const file = particle.file;
			const newSuite = srcSuite.clone(); // Doesn't copy tests and hooks
			// Create a nested suite for each platform
			for (let platform of particle.platforms) {
				const platformSuite = MochaSuite.create(newSuite, platform.name);
				platformSuite.particle = {
					platform,
					file
				};
				const suiteWrapper = this._initPlatformSuite(platformSuite);
				// Create a nested suite for each combination of the remaining parameters
				for (let systemThread of particle.systemThreadModes) {
					for (let systemMode of particle.systemModes) {
						const params = [];
						params.push(`systemThread=${systemThread}`);
						// System mode is hidden by default
						if (!particle.hasDefaultSystemModes) {
							params.push(`systemMode=${systemMode}`);
						}
						const title = chalk.dim(params.join(', '));
						const suite = MochaSuite.create(platformSuite, title);
						suite.particle = {
							platform,
							systemThread,
							systemMode,
							file
						};
						suite.beforeEach(async function() {
							try {
								await suiteWrapper.runTest(this.currentTest);
							} catch (e) {
								// An exception thrown from a beforeEach() hook prevents all other tests from running
								delete e.stack; // FIXME
								this.currentTest.fn = () => Promise.reject(e);
							}
						});
						if (srcSuite.tests.length) {
							// Copy tests
							for (let test of srcSuite.tests) {
								suite.addTest(test.clone());
							}
						} else {
							// Add a dummy test to force Mocha to run hooks
							const test = new MochaTest('', () => {});
							suite.addTest(test);
						}
						// Copy hooks
						for (let hook of srcSuite.getHooks(MochaSuite.constants.HOOK_TYPE_BEFORE_ALL)) {
							suite.beforeAll(hook.fn);
						}
						for (let hook of srcSuite.getHooks(MochaSuite.constants.HOOK_TYPE_AFTER_ALL)) {
							suite.afterAll(hook.fn);
						}
						for (let hook of srcSuite.getHooks(MochaSuite.constants.HOOK_TYPE_BEFORE_EACH)) {
							suite.beforeEach(hook.fn);
						}
						for (let hook of srcSuite.getHooks(MochaSuite.constants.HOOK_TYPE_AFTER_EACH)) {
							suite.afterEach(hook.fn);
						}
					}
				}
			}
			for (let suite of srcSuite.suites) {
				const name = suiteDisplayName(suite.title);
				this._log.warn(`${file}: ${name}: Nested suites are not supported`);
			}
			suites.push(newSuite);
		}
		// Replace original suites
		rootSuite.suites = suites;
	}

	_addDeviceTests(platformSuite, deviceTests) {
		const mochaTests = [];
		for (let suite of platformSuite.suites) {
			const tests = suite.tests;
			if (tests.length === 1 && !tests[0].title) {
				tests.shift(); // Remove the dummy test
			}
			if (!mochaTests.length) {
				for (let test of tests) {
					mochaTests.push(test.title);
				}
			}
		}
		const deviceOnlyTests = new Set(deviceTests);
		for (let mochaTest of mochaTests) {
			const deviceTest = findTestName(deviceOnlyTests, mochaTest);
			if (deviceTest) {
				deviceOnlyTests.delete(deviceTest);
			}
		}
		for (let suite of platformSuite.suites) {
			for (let deviceTest of deviceOnlyTests) {
				const test = new MochaTest(deviceTest, () => {});
				suite.addTest(test);
			}
		}
		return deviceOnlyTests;
	}

	_initPlatformSuite(suite) {
		const wrapper = new PlatformSuite({ suite, log: this._log });
		suite.beforeAll(async function() {
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
		suite.afterAll(async function() {
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
		for (let suite of rootSuite.suites) {
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

	_applySuiteConfig() {
		this._knownSuiteTags = new Set();
		const rootSuite = this._mocha.suite;
		for (let test of rootSuite.tests) {
			const file = path.relative(this._testDir, test.file);
			const name = testDisplayName(test.title);
			this._log.warn(`${file}: ${name}: Test case is defined outside of a test suite`);
		}
		for (let suite of rootSuite.suites) {
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
			delete particle.config;
		}
	}

	_loadTestFiles() {
		let originalSuiteFn = null;
		// This function creates a wrapper for the Mocha's describe() function. The wrapper forwards
		// its arguments to the original function and stores a reference to the newly created suite
		// in the global context object. This can also be done via the Suite's EVENT_SUITE_ADD_SUITE
		// event, but it's marked as deprecated in the reference docs
		const createSuiteFn = (ctx, fn) => function(...args) {
			const suite = fn(...args);
			suite.particle = {
				file: ctx.particle.currentFile
			};
			ctx.particle.currentSuite = suite;
			return suite;
		};
		const preRequire = (ctx, file) => {
			this._log.debug(`Loading file: ${file}`);
			ctx.particle = {
				currentFile: path.relative(this._testDir, file)
			};
			if (ctx.describe) { // BDD
				originalSuiteFn = ctx.describe;
				ctx.describe = createSuiteFn(ctx, ctx.describe);
			} else if (ctx.suite) { // TDD/QUnit
				originalSuiteFn = ctx.suite;
				ctx.suite = createSuiteFn(ctx, ctx.suite);
			} else {
				throw new InternalError('Unsupported interface');
			}
		};
		const postRequire = (ctx) => {
			// Restore the context
			if (ctx.describe) {
				ctx.describe = originalSuiteFn;
			} else if (ctx.suite) {
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

	_findTestFiles(glob) {
		return fg.sync(glob, {
			cwd: this._testDir,
			ignore: ['**/node_modules/**'],
			onlyFiles: true
		});
	}

	_registerGlobals() {
		global.particle = {};
		for (let name in globals) {
			if (name in global) {
				throw new InternalError(`Name of a global is already in use: ${name}`);
			}
			global[name] = globals[name];
		}
	}

	_unregisterGlobals() {
		for (let name in globals) {
			delete global[name];
		}
		delete global.particle;
	}
}
