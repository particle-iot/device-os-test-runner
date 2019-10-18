import { PLATFORMS } from './platform';
import * as globals from './globals';
import { SpecError, InternalError } from './error';

import Mocha from 'mocha';
import chalk from 'chalk';
import fg from 'fast-glob';

import * as path from 'path';

const DEFAULT_PLATFORMS = PLATFORMS.filter(p => !p.disabled).sort((p1, p2) => p1 - p2);
const DEFAULT_SYSTEM_MODES = ['semi-automatic'];
const DEFAULT_SYSTEM_THREAD_MODES = ['disabled', 'enabled'];

const Suite = Mocha.Suite;

export class Runner {
	constructor({ log }) {
		this._log = log;
		this._mocha = null;
		this._specDir = null;
	}

	async init() {
		this._specDir = process.cwd(); // FIXME
		const specFiles = this._findSpecs();
		this._mocha = new Mocha({	ui: 'qunit'	});
		this._registerSuiteEventHandlers();
		specFiles.forEach(file => this._mocha.addFile(`${this._specDir}/${file}`));
		this._mocha.loadFiles();
		this._generateTestMatrix();
	}

	async run() {
		const ok = await this._run();
		return ok;
	}

	_generateTestMatrix() {
		this._log.debug('Generating a test matrix');
		const rootSuite = this._mocha.suite;
		if (rootSuite.tests.length > 0) {
			const file = path.relative(this._specDir, rootSuite.tests[0].file);
			// This is most likely an error
			this._log.warn(`${file}: Test case is defined outside of a test suite`);
		}
		for (let suiteIndex = 0; suiteIndex < rootSuite.suites.length; ++suiteIndex) {
			const origSuite = rootSuite.suites[suiteIndex];
			if (!origSuite.particle) {
				throw new InternalError();
			}
			const specFile = origSuite.particle.specFile;
			const config = origSuite.particle.config || {};
			// Target platforms
			let platforms = null;
			if (config.platforms) {
				platforms = Array.from(config.platforms.values());
				platforms.sort((p1, p2) => p1.id - p2.id); // Sort platforms by ID
			} else {
				this._log.warn(`${specFile}: Target platform is not specified`);
				platforms = DEFAULT_PLATFORMS; // Run on all platforms
			}
			// System thread modes
			let systemThreadModes = [];
			if (config.systemThreadModes) {
				systemThreadModes = Array.from(config.systemThreadModes.values());
				systemThreadModes.sort();
			} else {
				systemThreadModes = DEFAULT_SYSTEM_THREAD_MODES;
			}
			// System modes
			let systemModes = null;
			if (config.systemModes) {
				systemModes = Array.from(config.systemModes.values());
				systemModes.sort();
			} else {
				systemModes = DEFAULT_SYSTEM_MODES;
			}
			const newSuite = origSuite.clone(); // Doesn't copy tests and hooks
			// Create a nested suite for each platform
			for (let platform of platforms) {
				const platformSuite = Suite.create(newSuite, platform.name);
				// Create a nested suite for each combination of the remaining parameters
				for (let systemThread of systemThreadModes) {
					for (let systemMode of systemModes) {
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

	_findSpecs() {
		const specs = fg.sync('**/*.spec.js', {
			cwd: this._specDir,
			ignore: ['**/node_modules/**'],
			onlyFiles: true
		});
		return specs.sort();
	}

	_run() {
		return new Promise((resolve, reject) => {
			this._mocha.run(failureCount => {
				resolve(!failureCount);
			});
		});
	}
}
