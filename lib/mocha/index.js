import { Test } from '../test';
import { Suite } from '../suite';
import { Runner } from '../runner';
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
		mSuite.beforeAll('', function() {
			applySuiteConfig(parentObject(currentHook(this)));
		});
	}
	return suite;
}

function applySuiteConfig(mParentSuite) {
	// TODO: This is obviously an ugly hack and it's not guaranteed to work with future versions of Mocha
	const tests = mParentSuite.tests;
	mParentSuite.tests = [];
  const dummySuite = clone(mParentSuite);
  // FIXME: Remove only internal helper hooks
  dummySuite._beforeAll = [];
	// Create a nested suite for each combination of test parameters
	const parentSuite = mParentSuite.harness.suite;
	for (let platform of parentSuite.platforms) {
		const mSuite = clone(dummySuite);
		mSuite.title = `platform=${platform.name}`;
		const suite = new Suite({ path: parentSuite.path, parent: parentSuite, log: parentSuite.log });
		suite.setPlatforms([ platform ]);
		mSuite.harness.suite = suite;
		tests.forEach(mTest => {
			mTest = clone(mTest);
			const test = new Test({ parent: suite, log: suite.log });
			mTest.harness = { test };
			mSuite.addTest(mTest);
		});
		mParentSuite.addSuite(mSuite);
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
