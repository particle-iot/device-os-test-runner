import { Runner } from '../runner';
import { Logger } from '../logger';
import { loadConfig } from '../config';
import { currentTest, currentHook, parentObject } from './util';

before(async function() {
	const config = loadConfig();
	const log = new Logger(config.get('log'));
	const runner = new Runner({ log });
	// This hook is global, so its parent is the root suite
	const root = parentObject(currentHook(this));
	root.harness = { runner };
	return runner.init();
});

beforeEach(function() {
	const mSuite = parentObject(currentTest(this));
	let platforms = null;
	if (mSuite.harness) {
		// Get internal suite object
		const suite = mSuite.harness.suite;
		if (suite) {
			platforms = suite.platforms;
		}
	}
	if (!platforms || !platforms.length) {
		// This is typically caused by a missing call to platforms()
		throw new Error('Target platform is not specified');
	}
});
