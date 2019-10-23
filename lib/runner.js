import { PLATFORMS, platformTags } from './platform';
import * as globals from './globals';
import { RunMode, OutputFormat, config } from './config';
import { shortenRight, stringifyJson } from './util';
import { SpecError, InternalError } from './error';

import Mocha from 'mocha';
import chalk from 'chalk';
import fg from 'fast-glob';

import * as path from 'path';

const DEFAULT_PLATFORMS = PLATFORMS.filter(p => !p.disabled).sort((p1, p2) => p1 - p2);
const DEFAULT_SYSTEM_MODES = ['semi-automatic'];
const DEFAULT_SYSTEM_THREAD_MODES = ['disabled', 'enabled'];

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
		this._specDir = null; // Test directory
		this._runMode = null; // Run mode
	}

	async init() {
		this._runMode = config.get('runMode');
		// Get the list of test files
		this._specDir = config.get('testDir');
		const specFiles = this._findSpecs();
		if (!specFiles.length) {
			throw new Error('No test files found');
		}
		// Initialize Mocha and load tests
		this._mocha = new Mocha({	ui: 'qunit'	});
		this._registerSuiteEventHandlers();
		specFiles.forEach(file => this._mocha.addFile(`${this._specDir}/${file}`));
		this._mocha.loadFiles();
		this._applySuiteConfig();
	}

	async shutdown() {
	}

	async run() {
		let ok = true;
		switch (this._runMode) {
			case RunMode.NORMAL:
			case RunMode.DRY_RUN: {
				this._initTestMatrix();
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
		return new Promise((resolve, reject) => {
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
			file: suite.particle.specFile,
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
					const index = lines.length;
					for (let test of suite.tests) {
						lines.push(' '.repeat(padding) + test.name);
					}
					lines[index] = 'tests:'.padEnd(padding) + lines[index].substring(padding);
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
			console.log(stringifyJson(tags));
		} else if (tags.length) {
			console.log(tags.join('\n'));
		}
	}

	_initTestMatrix() {
		this._log.verbose('Generating a test matrix');
		const rootSuite = this._mocha.suite;
		for (let suiteIndex = 0; suiteIndex < rootSuite.suites.length; ++suiteIndex) {
			const origSuite = rootSuite.suites[suiteIndex];
			const newSuite = origSuite.clone(); // Doesn't copy tests and hooks
			const particle = origSuite.particle;
			const specFile = particle.specFile;
			// Create a nested suite for each platform
			for (let platform of particle.platforms) {
				const platformSuite = Suite.create(newSuite, platform.name);
				// Create a nested suite for each combination of the remaining parameters
				for (let systemThread of particle.systemThreadModes) {
					for (let systemMode of particle.systemModes) {
						const params = [];
						params.push(`systemThread=${systemThread}`);
						// System mode is hidden by default
						if (config.systemModes) {
							params.push(`systemMode=${systemMode}`);
						}
						const title = chalk.dim(params.join(', '));
						const suite = Suite.create(platformSuite, title);
						suite.particle = {
							platform,
							systemThread,
							systemMode,
							specFile
						};
						// Copy tests
						for (let test of origSuite.tests) {
							suite.addTest(test.clone());
						}
						// Copy hooks
						for (let hook of origSuite.getHooks(Suite.constants.HOOK_TYPE_BEFORE_ALL)) {
							suite.beforeAll(hook.fn);
						}
						for (let hook of origSuite.getHooks(Suite.constants.HOOK_TYPE_AFTER_ALL)) {
							suite.afterAll(hook.fn);
						}
						for (let hook of origSuite.getHooks(Suite.constants.HOOK_TYPE_BEFORE_EACH)) {
							suite.beforeEach(hook.fn);
						}
						for (let hook of origSuite.getHooks(Suite.constants.HOOK_TYPE_AFTER_EACH)) {
							suite.afterEach(hook.fn);
						}
					}
				}
			}
			for (let suite of origSuite.suites) {
				const name = suiteDisplayName(suite.title);
				this._log.warn(`${specFile}: ${name}: Nested suites are not supported`);
			}
			// Replace the original suite
			rootSuite.suites[suiteIndex] = newSuite;
		}
	}

	_registerSuiteEventHandlers() {
		// This function replaces the Mocha's describe() function with a wrapper that stores a reference
		// to the newly created suite in the context object. This can also be done via the Suite's
		// EVENT_SUITE_ADD_SUITE event, but it's marked as deprecated in the reference docs
		const suiteWrapper = (ctx, fn) => function(...args) {
			const suite = fn(...args);
			// Particle-specific suite properties
			suite.particle = {
				specFile: ctx.particle.specFile
			};
			ctx.particle.currentSuite = suite;
			return suite;
		};
		this._mocha.suite.on(Suite.constants.EVENT_FILE_PRE_REQUIRE, (ctx, specFile) => {
			// Particle-specific context properties
			specFile = path.relative(this._specDir, specFile);
			ctx.particle = { specFile };
			for (let name in globals) {
				if (name in ctx) {
					throw new InternalError(`Name of a global is already in use: ${name}`);
				}
				const val = globals[name];
				if (typeof val === 'function' && val.needsContext) {
					ctx[name] = val(ctx);
				} else {
					ctx[name] = val;
				}
			}
			if (ctx.describe) { // BDD
				ctx.describe = suiteWrapper(ctx, ctx.describe);
			} else if (ctx.suite) { // TDD/QUnit
				ctx.suite = suiteWrapper(ctx, ctx.suite);
			} else {
				throw new InternalError('Unsupported interface');
			}
		});
		this._mocha.suite.on(Suite.constants.EVENT_FILE_POST_REQUIRE, ctx => {
			for (let name in globals) {
				delete ctx[name];
			}
			delete ctx.particle;
		});
	}

	_applySuiteConfig() {
		this._suiteTags = new Set();
		const rootSuite = this._mocha.suite;
		for (let test of rootSuite.tests) {
			const file = path.relative(this._specDir, test.file);
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
				this._log.warn(`${particle.specFile}: ${name}: Target platform is not specified`);
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
			} else {
				particle.systemModes = DEFAULT_SYSTEM_MODES;
			}
			// Update the list of known tags
			if (particle.tags) {
				particle.tags.forEach(tag => this._suiteTags.add(tag));
			} else {
				particle.tags = new Set();
			}
			delete particle.config;
		}
	}

	_findSpecs() {
		const specs = fg.sync('**/*.spec.js', {
			cwd: this._specDir,
			ignore: ['**/node_modules/**'],
			onlyFiles: true
		});
		return specs.sort();
	}
}
