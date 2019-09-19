import { config } from './config';

import mkdirp from 'mkdirp';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

const execAsync = util.promisify(childProcess.exec);

export async function buildApp({ appPath, appName, platform, log }) {
	log.verbose(`Building application: ${appPath}`);
	const deviceOs = config.get('deviceOs.path');
	if (!deviceOs) {
		throw new Error(`Device OS directory is not specified`);
	}
	let buildDir = config.get('build.path');
	if (!buildDir) {
		buildDir = path.dirname(process.argv[1]);
		const index = buildDir.indexOf('/node_modules/');
		if (index >= 0) {
			buildDir = buildDir.substring(0, index);
		}
		buildDir = `${buildDir}/build/${appName}/${platform.name}`;
		mkdirp.sync(buildDir);
	}
	const cmd = `make all PLATFORM=${platform.name} APPDIR=${appPath} TARGET_DIR=${buildDir} TARGET_FILE=${appName} 2>&1`;
	// log.debug(cmd);
	const { stdout } = await execAsync(cmd, { cwd: `${deviceOs}/main` });
	return `${buildDir}/${appName}.bin`;
}
