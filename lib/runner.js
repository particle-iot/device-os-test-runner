import { SuiteWrapper } from './suite';
import { PLATFORMS, platformTags } from './platform';
import { RunMode, OutputFormat, config } from './config';
import { shortenRight, stringifyJson } from './util';
import { InternalError } from './error';
import * as globals from './globals';

import Mocha from 'mocha';
import chalk from 'chalk';
import fg from 'fast-glob';

import * as path from 'path';

const DEFAULT_PLATFORMS = PLATFORMS.filter(p => !p.disabled).sort((p1, p2) => p1 - p2);
const DEFAULT_SYSTEM_MODES = ['semi-automatic'];
const DEFAULT_SYSTEM_THREAD_MODES = ['disabled', 'enabled'];
const DEFAULT_TEST_TIMEOUT = 10 * 60 * 1000;

const Suite = Mocha.Suite;

function suiteDisplayName(name) {
	name = shortenRight(name, 30, '~');
	return `suite('${name}')`;
}

function testDisplayName(name) {
	name = shortenRight(name, 30, '~');
	return `test('${name}')`;
}

export class Runner {
	constructor({ log }) {
		this._log = log; // Logger instance
		this._mocha = null; // Mocha instance
		this._suiteTags = null; // All known suite tags
		this._testDir = null; // Test directory
		this._runMode = null; // Run mode
	}

	async init() {
		this._runMode = config.get('runMode');
		this._testDir = config.get('testDir');
		// Initialize Mocha and load tests
		this._mocha = new Mocha({
			ui: 'qunit',
			timeout: DEFAULT_TEST_TIMEOUT,
			slow: Number.MAX_SAFE_INTEGER
		});
		this._registerGlobals();
		this._loadTestFiles();
		this._applySuiteConfig();
	}

	async shutdown() {
		this._unregisterGlobals();
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
		this._initTestMatrix();
		const ctx = this._mocha.suite.ctx;
		ctx.particle = {
			dryRun: this._runMode === RunMode.DRY_RUN
		};
		// Run tests
		return new Promise(resolve => {
			this._mocha.run(failureCount => {
				resolve(!failureCount);
			});
		});
	}

	async _build() {
		throw new InternalError('Not implemented');
	}

	async _listTests() {
		const rootSuite = this._mocha.suite;
		const suites = rootSuite.suites.map(suite => ({
			name: suite.title,
			file: suite.particle.file,
			platforms: suite.particle.platforms.map(p => p.name),
			systemThreadModes: suite.particle.systemThreadModes,
			systemModes: suite.particle.systemModes,
			tags: Array.from(suite.particle.tags.values()).sort(),
			tests: suite.tests.map(test => ({
				name: test.title
			}))
		}));
		if (config.get('outputFormat') === OutputFormat.JSON) {
			console.log(stringifyJson({	suites }));
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
		let tags = new Set([...this._suiteTags, ...platformTags()]);
		tags = Array.from(tags.values()).sort();
		if (config.get('outputFormat') === OutputFormat.JSON) {
			console.log(stringifyJson({ tags }));
		} else if (tags.length) {
			console.log(tags.join('\n'));
		}
	}

	_initTestMatrix() {
		this._log.verbose('Generating a test matrix');
		const rootSuite = this._mocha.suite;
		for (let suiteIndex = 0; suiteIndex < rootSuite.suites.length; ++suiteIndex) {
			const srcSuite = rootSuite.suites[suiteIndex];
			const newSuite = srcSuite.clone(); // Doesn't copy tests and hooks
			const particle = srcSuite.particle;
			const file = particle.file;
			// Create a nested suite for each platform
			for (let platform of particle.platforms) {
				const platformSuite = Suite.create(newSuite, platform.name);
				platformSuite.particle = {
					platform,
					file
				};
				const suiteWrapper = new SuiteWrapper({
					suite: platformSuite,
					log: this._log
				});
				platformSuite.beforeAll(async function() {
					await suiteWrapper.init(this); // Forward the context object to the wrapper
				});
				platformSuite.afterAll(async function() {
					await suiteWrapper.shutdown();
				});
				// Create a nested suite for each combination of the remaining parameters
				for (let systemThread of particle.systemThreadModes) {
					for (let systemMode of particle.systemModes) {
						const params = [];
						params.push(`systemThread=${systemThread}`);
						// System mode is hidden by default
						if (!particle.usesDefaultSystemModes) {
							params.push(`systemMode=${systemMode}`);
						}
						const title = chalk.dim(params.join(', '));
						const suite = Suite.create(platformSuite, title);
						suite.particle = {
							platform,
							systemThread,
							systemMode,
							file
						};
						// Copy tests
						for (let test of srcSuite.tests) {
							suite.addTest(test.clone());
						}
						// Copy hooks
						for (let hook of srcSuite.getHooks(Suite.constants.HOOK_TYPE_BEFORE_ALL)) {
							suite.beforeAll(hook.fn);
						}
						for (let hook of srcSuite.getHooks(Suite.constants.HOOK_TYPE_AFTER_ALL)) {
							suite.afterAll(hook.fn);
						}
						for (let hook of srcSuite.getHooks(Suite.constants.HOOK_TYPE_BEFORE_EACH)) {
							suite.beforeEach(hook.fn);
						}
						for (let hook of srcSuite.getHooks(Suite.constants.HOOK_TYPE_AFTER_EACH)) {
							suite.afterEach(hook.fn);
						}
					}
				}
			}
			for (let suite of srcSuite.suites) {
				const name = suiteDisplayName(suite.title);
				this._log.warn(`${file}: ${name}: Nested suites are not supported`);
			}
			// Replace the original suite
			rootSuite.suites[suiteIndex] = newSuite;
		}
	}

	_applySuiteConfig() {
		this._suiteTags = new Set();
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
			if (config.platforms) {
				const platforms = Array.from(config.platforms.values());
				platforms.sort((p1, p2) => p1.id - p2.id); // Sort platforms by ID
				particle.platforms = platforms;
			} else {
				const name = suiteDisplayName(suite.title);
				this._log.warn(`${particle.file}: ${name}: Target platform is not specified`);
				particle.platforms = DEFAULT_PLATFORMS; // Run on all platforms
			}
			// System thread modes
			if (config.systemThreadModes) {
				particle.systemThreadModes = Array.from(config.systemThreadModes.values()).sort();
			} else {
				particle.systemThreadModes = DEFAULT_SYSTEM_THREAD_MODES;
			}
			// System modes
			if (config.systemModes) {
				particle.systemModes = Array.from(config.systemModes.values()).sort();
				particle.usesDefaultSystemModes = false;
			} else {
				particle.systemModes = DEFAULT_SYSTEM_MODES;
				particle.usesDefaultSystemModes = true;
			}
			// Suite tags
			if (config.tags) {
				config.tags.forEach(tag => this._suiteTags.add(tag));
				particle.tags = config.tags;
			} else {
				particle.tags = new Set();
			}
			delete particle.config;
		}
	}

	_loadTestFiles() {
		// Get the list of test files
		const files = this._findTestFiles();
		if (!files.length) {
			throw new Error('No test files found');
		}
		files.forEach(file => this._mocha.addFile(`${this._testDir}/${file}`));
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
		let originalSuiteFn = null;
		const preRequire = (ctx, file) => {
			file = path.relative(this._testDir, file);
			ctx.particle = {
				currentFile: file
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
		this._mocha.suite.on(Suite.constants.EVENT_FILE_PRE_REQUIRE, preRequire);
		this._mocha.suite.on(Suite.constants.EVENT_FILE_POST_REQUIRE, postRequire);
		this._mocha.loadFiles();
		this._mocha.suite.off(Suite.constants.EVENT_FILE_PRE_REQUIRE, preRequire);
		this._mocha.suite.off(Suite.constants.EVENT_FILE_POST_REQUIRE, postRequire);
	}

	_findTestFiles() {
		const files = fg.sync('**/*.spec.js', {
			cwd: this._testDir,
			ignore: ['**/node_modules/**'],
			onlyFiles: true
		});
		return files.sort();
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
