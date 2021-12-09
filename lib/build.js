const { execCommand } = require('./util');

const glob = require('glob');

const path = require('path');

const APP_SRC_PATTERN = '**/*.{c,cpp,cc,h,hpp,hh,mk}';

class Builder {
	constructor({ testDir, deviceOsDir, tempDir, log }) {
		this._log = log; // Logger instance
		this._testDir = testDir; // Test directory
		this._deviceOsDir = deviceOsDir; // Device OS directory
		this._tempDir = tempDir; // Temp directory
	}

	async init() {
	}

	async shutdown() {
	}

	findApps(suiteDir) {
		const srcFiles = glob.sync(APP_SRC_PATTERN, {
			cwd: path.join(this._testDir, suiteDir),
			ignore: ['**/node_modules/**'],
			nodir: true,
			absolute: false
		});
		if (!srcFiles.length) {
			return [];
		}
		const appDirs = new Set();
		for (const srcFile of srcFiles) {
			const paths = srcFile.split(path.sep);
			if (paths.length === 1) {
				// If there's a source file in the suite's root directory, then all source files belong to
				// the same application
				appDirs.clear();
				break;
			}
			appDirs.add(path.join(suiteDir, paths[0]));
		}
		if (appDirs.size < 2) {
			return [suiteDir];
		}
		return Array.from(appDirs.values()).sort();
	}

	async buildApp({ appDir, platform }) {
		if (!this._deviceOsDir) {
			throw new Error('Device OS directory is not specified');
		}
		const appName = path.basename(appDir);
		const targetDir = path.join(this._tempDir, 'build', platform.name, appDir);
		const cmd = 'make';
		const args = ['-s', 'all', `PLATFORM=${platform.name}`, `TEST=integration/${appDir}`, `TARGET_DIR=${targetDir}`,
			'EXTRA_CFLAGS=-DPARTICLE_TEST_RUNNER'];
		const cwd = path.join(this._deviceOsDir, 'main');
		this._log.debug(`Running command: ${cmd} ${args.join(' ')}`);
		const result = await execCommand(cmd, args, cwd);
		if (result.code !== 0) {
			throw new Error(`\`${cmd}\` failed with the exit code ${result.code}:\n${result.stdout}`);
		}
		// Find application binary
		const binFiles = glob.sync(appName + '.bin', {
			cwd: targetDir,
			nodir: true,
			absolute: true
		});
		if (binFiles.length !== 1) {
			throw new Error('Application binary is not found');
		}
		return binFiles[0];
	}
}

module.exports = {
	Builder
};
