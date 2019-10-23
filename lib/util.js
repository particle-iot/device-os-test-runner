import simpleGit from 'simple-git/promise';

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

export async function delay(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}
