#!/usr/bin/env node

const { Runner } = require('./runner');
const { Logger } = require('./logger');
const { RunMode, initConfig, showUsage, config } = require('./config');
const { isInternalError } = require('./error');
const { version: PACKAGE_VERSION } = require('../package.json');

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
