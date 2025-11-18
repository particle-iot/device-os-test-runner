'use strict';
const { execCommand } = require('./util');

function parseHubAndPort(portPath) {
	const lastDot = portPath.lastIndexOf('.');
	if (lastDot === -1) {
		throw new Error(`Invalid portPath format: ${portPath}`);
	}
	const hub = portPath.slice(0, lastDot);
	const port = portPath.slice(lastDot + 1);

	return { hub, port };
}

async function isUhubctlInstalled() {
	try {
		const result = await execCommand('which', ['uhubctl']);
		return result.code === 0;
	} catch {
		return false;
	}
}

// Cycle the USB hub port with uhubctl
async function cycleUSBwithPortPath(portPath, { delaySec = 2 } = {}) {
	if (!portPath) {
		throw new Error('USB portPath required');
	}

	const hasUhubctl = await isUhubctlInstalled();
	if (!hasUhubctl) {
		console.error('uhubctl is not installed. Skipping USB hub cycle. Install from: https://github.com/mvp/uhubctl');
		return;
	}

	const { hub, port } = parseHubAndPort(portPath);
	const result = await execCommand('uhubctl',
		['-l', hub, '-p', port, '-a', 'cycle', '-d', String(delaySec)]
	);

	if (result.code !== 0) {
		throw new Error(`uhubctl failed with code ${result.code}: ${result.stdout}`);
	}
}

module.exports = { cycleUSBwithPortPath };
