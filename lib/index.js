#!/usr/bin/env node

const { Runner } = require('./runner');
const { Logger } = require('./logger');
const { RunMode, initConfig, showUsage, config } = require('./config');
const { isInternalError } = require('./error');
const { version: PACKAGE_VERSION } = require('../package.json');
const async_hooks = require('async_hooks');

let hook = null;
let hookMap = new Map();

async function run() {
	hook = async_hooks.createHook({
		init: (asyncId, type, triggerAsyncId, resource) => {
			if (resource && resource._timerArgs && resource._timerArgs[0] == 'notrack') {
				return;
			}
			const error = {};
			Error.captureStackTrace(error);
			const stack = error.stack.split("\n").map(line => line.trim()).slice(1);
			hookMap.set(asyncId, {
				type,
				triggerAsyncId,
				resource,
				stack,
				count: 0,
				timer: type == 'PROMISE' ? setInterval(() => {
					console.log('================================================================');
					const m = hookMap.get(asyncId);
					m.count++;
					console.log(`async op=${asyncId} stalled for over ${10 * m.count} mins`);
					console.log(type);
					console.log(resource);
					console.log('stack:');
					console.log(stack);
					let parentId = triggerAsyncId;
					while (parentId) {
						const parent = hookMap.get(parentId);
						if (!parent) {
							break;
						}
						parentId = parent.triggerAsyncId;
						console.log(`Parent ${parentId}`);
						console.log(type);
						console.log(resource);
						console.log('stack:');
						console.log(parent.stack);
					}
					console.log('done=============================================================\r\n\r\n');
				}, 10 * 60 * 1000, 'notrack') : null
			});
		},
		destroy: (asyncId) => {
			const task = hookMap.get(asyncId);
			if (task && task.timer) {
				clearInterval(task.timer);
			}
			hookMap.delete(asyncId);
		},
		promiseResolve: (asyncId) => {
			const task = hookMap.get(asyncId);
			if (task && task.timer) {
				clearInterval(task.timer);
			}
			hookMap.delete(asyncId);
		},
	});
	hook.enable();
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
