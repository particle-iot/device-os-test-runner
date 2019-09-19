import { Test } from '../test';
import { Suite } from '../suite';
import { Runner } from '../runner';
import { buildApp } from '../build';
import { parsePlatforms } from '../platform';
import { currentHook, parentObject } from './util';

import clone from 'clone';
import chai from 'chai';

import * as path from 'path';

global.expect = chai.expect;

// Returns internal suite object for a Mocha suite, creating it if necessary
function initSuite(mSuite) {
	let harness = mSuite.harness;
	if (!harness) {
		harness = {};
		mSuite.harness = harness;
	}
	let suite = harness.suite;
	if (!suite) {
		let parent = null; // Internal parent object
		const mParent = mSuite.parent; // Mocha parent object
		if (mParent && mParent.harness) {
			if (mParent.root) {
				parent = mParent.harness.runner;
			} else {
				parent = mParent.harness.suite;
			}
		}
		if (!parent) {
			throw new Error('Unable to get parent suite');
		}
		if (!mSuite.tests || !mSuite.tests.length) {
			throw new Error('Unable to get test directory');
		}
		const p = path.dirname(mSuite.tests[0].file);
		suite = new Suite({ path: p, parent, log: parent.log });
		harness.suite = suite;
		// Register a hook to apply the configuration
		mSuite.beforeAll('', async function() {
			return applySuiteConfig(parentObject(currentHook(this)));
		});
	}
	return suite;
}

async function applySuiteConfig(mParentSuite) {
	// TODO: Refactoring
	const tests = mParentSuite.tests;
	mParentSuite.tests = [];
  const dummySuite = clone(mParentSuite);
  // FIXME: Remove only internal helper hooks
  dummySuite._beforeAll = [];
	// Create a nested suite for each combination of test parameters
	const parentSuite = mParentSuite.harness.suite;
	const runner = parentSuite.runner;
	for (let platform of parentSuite.platforms) {
		const device = runner.devices.forPlatform(platform.name);
		const mSuite = clone(dummySuite);
		mSuite.title = `platform=${platform.name}`;
		const suite = new Suite({ path: parentSuite.path, parent: parentSuite, log: parentSuite.log });
		suite.setPlatforms([ platform ]);
		mSuite.harness.suite = suite;
		tests.forEach(mTest => {
			mTest = clone(mTest);
			const test = new Test({ device, parent: suite, log: suite.log });
			mTest.harness = { test };
			mSuite.addTest(mTest);
		});
		mParentSuite.addSuite(mSuite);
		mSuite.beforeAll('', async function() {
			if (!device) {
				this.skip();
				return;
			}
			runner.log.verbose(`Device: ${device.displayName}`);
			const binFile = await buildApp({
				appPath: `${suite.path}/app`,
				appName: path.basename(suite.path),
				platform: suite.platforms[0],
				log: suite.log
			});
			await device.flash(binFile);
		});
		mSuite.beforeEach('', async function() {
			const test = this.currentTest;
			try {
				await device.runTest(test.title);
			} catch (e) {
				// FIXME: An error in a beforeEach() hook prevents all other tests from running
				test.fn = () => {
					if (test.async) {
						return Promise.reject(e);
					}
					throw e;
				};
			}
		});
	}
}

/**
 * Set target platforms.
 */
global.platforms = function(...tags) {
	before(function() {
		if (!this.currentTest) {
			throw new Error('platforms() is called outside of a test suite');
		}
		// Parse platform tags
		const platforms = parsePlatforms(tags);
		// Update suite parameters
		const mSuite = parentObject(currentHook(this));
		const suite = initSuite(mSuite);
		suite.setPlatforms(platforms);
	});
}

/**
 * Set target devices.
 */
global.devices = function(...devices) {
	before(function() {
		if (!this.currentTest) {
			throw new Error('devices() is called outside of a test suite');
		}
		// Update suite parameters
		const mSuite = parentObject(currentHook(this));
		const suite = initSuite(mSuite);
		// TODO
	});
}


/**
 * Set compile time macro definitions.
 */
global.defines = function(...defines) {
	before(function() {
		if (!this.currentTest) {
			throw new Error('defines() is called outside of a test suite');
		}
		// Update suite parameters
		const mSuite = parentObject(currentHook(this));
		const suite = initSuite(mSuite);
		// TODO
	});
}

/**
 * Set runtime test parameters.
 */
global.parameters = function(...params) {
	before(function() {
		if (!this.currentTest) {
			throw new Error('parameters() is called outside of a test suite');
		}
		// Update suite parameters
		const mSuite = parentObject(currentHook(this));
		const suite = initSuite(mSuite);
		// TODO
	});
}
