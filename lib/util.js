const simpleGit = require('simple-git');

const { spawn } = require('child_process');

const os = require('os');

async function findDeviceOsDirectory() {
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

async function execCommand(cmd, args, cwd) {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, {
			stdio: [
				'ignore', // stdin
				'pipe', // stdout
				'pipe' // stderr
			],
			shell: os.platform() !== 'win32' ? '/bin/bash' : process.env.comspec,
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
				reject(error);
				exited = true;
			}
		});
	});
}

async function delay(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

/**
 * Helper function for mapping Mocha and device tests to each other.
 */
function findTestName(set, name) {
	if (set.has(name)) {
		return name; // Exact match
	}
	// Replace non-identifier characters with underscores
	name = name.replace(/\W/g, '_');
	if (set.has(name)) {
		return name;
	}
	// Remove extra underscores
	name = name.replace(/_+/g, ' ').trim().replace(/ /g, '_');
	if (set.has(name)) {
		return name;
	}
	// Use lower case
	name = name.toLowerCase();
	if (set.has(name)) {
		return name;
	}
	return null; // Not found
}

function shortenRight(str, maxLength, ellipsis = '') {
	if (str.length > maxLength) {
		str = str.substring(0, maxLength - ellipsis.length).trimRight() + ellipsis;
	}
	return str;
}

module.exports = {
	findDeviceOsDirectory,
	execCommand,
	delay,
	findTestName,
	shortenRight
};
