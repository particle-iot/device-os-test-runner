#!/usr/bin/env node

import { Runner } from './runner';
import { Logger } from './logger';
import { RunMode, initConfig, showUsage, config } from './config';
import { InternalError } from './error';
import { version as PACKAGE_VERSION } from '../package.json';

async function run() {
	let ok = true;
	let runner = null;
	try {
		await initConfig();
		switch (config.get('runMode')) {
			case RunMode.SHOW_VERSION: {
				console.log(PACKAGE_VERSION);
				break;
			}
			case RunMode.SHOW_USAGE: {
				showUsage();
				break;
			}
			default: {
				const log = new Logger(config.get('logLevel'));
				runner = new Runner({ log });
				await runner.init();
				ok = await runner.run();
				break;
			}
		}
	} catch (e) {
		if (config.get('verbose') || e instanceof InternalError || e instanceof TypeError ||
				e instanceof ReferenceError || e instanceof SyntaxError) {
			console.log(e.stack);
		} else {
			console.log(`Error: ${e.message}`);
		}
		ok = false;
	} finally {
		if (runner) {
			await runner.shutdown();
		}
	}
	process.exit(ok ? 0 : 1);
}

run();
