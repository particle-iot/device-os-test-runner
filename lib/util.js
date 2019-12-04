import simpleGit from 'simple-git/promise';

import { spawn } from 'child_process';
import * as fs from 'fs';

export async function findDeviceOsDirectory() {
	const git = simpleGit();
	let ok = await git.checkIsRepo();
	if (!ok) {
		return null;
	}
	const remotes = await git.getRemotes(true /* verbose */);
	ok = remotes.some(r => r.refs.fetch.endsWith('/device-os.git'));
	if (!ok) {
		return null;
	}
	const path = await git.revparse(['--show-toplevel']);
	return path;
}

export async function execCommand(cmd, args, cwd) {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, {
			stdio: [
				'ignore', // stdin
				'pipe', // stdout
				'pipe' // stderr
			],
			shell: '/bin/bash',
			cwd
		});
		let exited = false;
		let stdout = ''; // Combined stdout and stderr output
		p.stdout.on('data', data => stdout += data);
		p.stderr.on('data', data => stdout += data);
		p.on('exit', (code, signal) => {
			if (!exited) {
				if (signal) {
					reject(new Error(`Process terminated by ${signal}`));
				} else {
					resolve({ code, stdout });
				}
				exited = true;
			}
		});
		p.on('error', error => {
			if (!exited) {
				reject(error)
				exited = true;
			}
		});
	});
}

export async function delay(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

export function shortenRight(str, maxLength, ellipsis = '') {
	if (str.length > maxLength) {
		str = str.substring(0, maxLength - ellipsis.length).trimRight() + ellipsis;
	}
	return str;
}
