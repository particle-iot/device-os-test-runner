#!/usr/bin/env node

import { Runner } from './runner';
import { Logger } from './logger';
import { RunMode, initConfig, showUsage, config } from './config';
import { isInternalError } from './error';
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
				const log = new Logger({ level: config.get('logLevel') });
				runner = new Runner({ log });
				await runner.init();
				ok = await runner.run();
				break;
			}
		}
	} catch (e) {
		if (config.get('verbose') || isInternalError(e)) {
			console.error(e.stack);
		} else {
			console.error(`Error: ${e.message}`);
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
