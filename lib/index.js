#!/usr/bin/env node

import { Runner } from './runner';
import { Logger } from './logger';
import { RunnerError, InternalError } from './error';

import parseArgs from 'minimist';

async function run() {
	let ok = false;
	try {
		const argv = parseArgs(process.argv.slice(2), {
			string: '_',
			boolean: [ 'h' ],
			alias: {
				'h': 'help'
			}
		});
		const log = new Logger();
		const runner = new Runner({ log });
		await runner.init();
		ok = await runner.run();
	} catch (e) {
		if (e instanceof RunnerError && !(e instanceof InternalError)) {
			console.log(`Error: ${e.message}`);
		} else {
			console.log(e.stack);
		}
		ok = false;
	}
	process.exit(ok ? 0 : 1);
}

run();
