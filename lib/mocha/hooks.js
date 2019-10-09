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

after(async function() {
	const root = parentObject(currentHook(this));
	const runner = root.harness.runner;
	await runner.shutdown();
});

beforeEach(function() {
	const mTest = currentTest(this);
	if (!mTest.harness || !mTest.harness.test) {
		// This is typically caused by a missing call to platforms()
		throw new Error('Target platform is not specified');
	}
	const test = mTest.harness.test;
});
