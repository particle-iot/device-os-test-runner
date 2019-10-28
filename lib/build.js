import { config } from './config';

import mkdirp from 'mkdirp';

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

const execAsync = util.promisify(childProcess.exec);

// TODO: Move this code to the PlatformSuite class
export class AppBuilder {
	constructor({ log }) {
		this._log = log; // Logger instance
		this._deviceOsDir = null; // Device OS directory
		this._buildDir = null; // Build directory
	}

	async init() {
		this._buildDir = config.get('buildDir');
		this._log.verbose(`Build directory: ${this._buildDir}`);
		this._deviceOsDir = config.get('deviceOsDir');
		if (this._deviceOsDir) {
			this._log.verbose(`Device OS directory: ${this._deviceOsDir}`);
		}
	}

	async shutdown() {
	}

	async build({ appDir, appName, platform, targetDir }) {
		this._log.verbose(`Building application: ${appDir}`);
		if (!this._deviceOsDir) {
			throw new Error(`Device OS directory not found`);
		}
		if (!appName) {
			appName = path.dirname(appDir);
		}
		if (!path.isAbsolute(targetDir)) {
			targetDir = path.join(this._buildDir, targetDir);
		}
		this._log.verbose(`Target directory: ${targetDir}`);
		mkdirp.sync(targetDir);
		const cmd = `make all PLATFORM=${platform.name} APPDIR=${appDir} TARGET_DIR=${targetDir} TARGET_FILE=${appName} 2>&1`;
		// this._log.verbose(cmd);
		const { stdout } = await execAsync(cmd, {
			cwd: path.join(this._deviceOsDir, 'main')
		});
		return path.join(targetDir, appName + '.bin');
	}
};
