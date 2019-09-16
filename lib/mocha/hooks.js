import { Runner } from '../runner';
import { Logger } from '../logger';
import { config, loadConfig } from '../config';
import { rootSuiteFromContext } from './util';

before(async function() {
	loadConfig();
	const log = new Logger(config.get('log'));
	const runner = new Runner({ log });
	const root = rootSuiteFromContext(this);
	root.harness = { runner };
	return runner.init();
});

beforeEach(function() {
});
