import { LogLevel } from './logger';
import { findDeviceOsDirectory } from './util';
import { name as PACKAGE_NAME, description as PACKAGE_DESCRIPTION } from '../package.json';

import convict from 'convict';
import parseArgs from 'minimist';
import substitute from 'shellsubstitute';
import fg from 'fast-glob';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const APP_NAME = path.basename(PACKAGE_NAME);
const CONFIG_FILE_SUFFIX = `.config.json`;
const DEFAULT_TEST_DIR = `test/integration`;

let detectedDeviceOsDirectory = null;

/**
 * Run mode.
 */
export const RunMode = {
	NORMAL: 'normal',
	DRY_RUN: 'dry-run',
	BUILD: 'build',
	LIST_TESTS: 'list-tests',
	LIST_FIXTURES: 'list-fixtures',
	LIST_TAGS: 'list-tags',
	SHOW_VERSION: 'show-version',
	SHOW_USAGE: 'show-usage'
};

/**
 * Output format.
 */
export const OutputFormat = {
	TEXT: 'text',
	JSON: 'json'
};

convict.addFormat({
	name: 'array',
	validate: (array, schema) => {
		if (!Array.isArray(array)) {
			throw new Error('Expected an array');
		}
		array.forEach(item => {
			convict(schema.elements).load(item).validate({ allowed: 'strict' });
		});
	}
});

convict.addFormat({
	name: 'file',
	validate: file => {
		if (file) {
			file = substitute(file, process.env);
			if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
				throw new Error('Unable to open file');
			}
		}
	}
});

convict.addFormat({
	name: 'directory',
	validate: dir => {
		if (dir) {
			dir = substitute(dir, process.env);
			if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
				throw new Error('Unable to open directory');
			}
		}
	}
});

/**
 * Runner configuration.
 */
export const config = convict({
	devices: {
		doc: 'Device pool',
		format: 'array',
		elements: String,
		default: []
	},
	platforms: {
		doc: 'Enabled platforms',
		format: 'array',
		elements: String,
		default: []
	},
	fixtures: {
		doc: 'Device fixtures',
		format: 'array',
		default: [],
		elements: {
			name: {
				doc: 'Fixture name',
				format: String,
				default: ''
			},
			devices: {
				doc: 'Devices',
				format: 'array',
				elements: String,
				default: []
			}
		}
	},
	api: {
		url: {
			doc: 'API URL',
			format: 'url',
			default: 'https://api.particle.io',
			env: 'API_URL'
		},
		user: {
			doc: 'API username',
			format: String,
			default: '',
			env: 'API_USER'
		},
		password: {
			doc: 'API password',
			format: String,
			default: '',
			sensitive: true,
			env: 'API_PASSWORD'
		},
		token: {
			doc: 'API token',
			format: String,
			default: '',
			sensitive: true,
			env: 'API_TOKEN'
		},
		tokenDuration: {
			doc: 'API token duration',
			format: 'duration',
			default: '2 hours'
		}
	},
	// The remaining parameters are typically provided via the command line
	filters: {
		doc: 'Test filters',
		format: 'array',
		default: [],
		elements: String
	},
	deviceOsDir: {
		doc: 'Device OS directory',
		format: 'directory',
		default: ''
	},
	testDir: {
		doc: 'Test files directory',
		format: 'directory',
		default: ''
	},
	binaryDir: {
		doc: 'Firmware binaries directory',
		format: 'directory',
		default: ''
	},
	buildDir: {
		doc: 'Build directory',
		format: 'directory',
		default: ''
	},
	reportFile: {
		doc: 'Report file',
		format: String,
		default: ''
	},
	outputFormat: {
		doc: 'Output format',
		format: Object.values(OutputFormat),
		default: OutputFormat.TEXT
	},
	logLevel: {
		doc: 'Logging level',
		format: Object.values(LogLevel),
		default: LogLevel.WARN,
		env: 'LOG_LEVEL'
	},
	verbose: {
		doc: 'Enable verbose logging',
		format: Boolean,
		default: false
	},
	runMode: {
		doc: 'Run mode',
		format: Object.values(RunMode),
		default: RunMode.NORMAL
	}
});

export function showUsage() {
	console.log(`\
${PACKAGE_DESCRIPTION}

Usage: ${APP_NAME} [options...] [filters...]

Options:

-c FILE, --config=FILE
    Specify the configuration file.

--test-dir=PATH
    Specify the directory containing test files.

--binary-dir=PATH
    Specify the directory containing firmware binaries.

--device-os-dir=PATH
    Specify the Device OS directory.

--build-dir=PATH
    Specify the build directory.

--build
    Build application binaries.

--dry-run
    Verify that the configuration is valid.

--list-tests
    List all tests.

--list-fixtures
    List all fixtures.

--list-tags
    List all known tags.

-r FILE, --report=FILE
    Generate a report and save it to the file.

--json
    Use JSON as the output format.

-v, --verbose
    Enable verbose logging.

--version
    Show the version number.

-h, --help
    Show this message.

Examples:

${APP_NAME}
    Run all tests.

${APP_NAME} communication/keepalive
    Run tests in the specified directory.

${APP_NAME} photon p1
    Run tests tagged with the specified tags.`);
}

function loadCliProfile() {
	let profileName = 'particle';
	// Get the name of the active profile from ~/.particle/profile.json
	let profileFile = `${os.homedir()}/.particle/profile.json`;
	if (fs.existsSync(profileFile)) {
		const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
		if (profile.name) {
			profileName = profile.name;
		}
	}
	profileFile = `${os.homedir()}/.particle/${profileName}.config.json`;
	if (fs.existsSync(profileFile)) {
		const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
		if (profile.access_token) {
			config.set('api.token', profile.access_token);
			if (profile.apiUrl) {
				config.set('api.url', profile.apiUrl);
			}
			return true;
		}
	}
	return false;
}

function parseCmdLine() {
	return parseArgs(process.argv.slice(2), {
		string: ['_', 'config', 'test-dir', 'binary-dir', 'device-os-dir', 'build-dir', 'report'],
		boolean: ['build', 'dry-run', 'list-tests', 'list-fixtures', 'list-tags', 'version', 'help', 'json', 'verbose'],
		alias: {
			'config': 'c',
			'report': 'r',
			'verbose': 'v',
			'help': 'h'
		},
		unknown: arg => {
			throw new RangeError(`Unknown argument: ${arg}`);
		}
	});
}

// This function combines all parameters into the global config object:
// - Parameters passed via the command line take precedence.
// - If the Device OS directory is not specified, try to determine it based on the current directory.
// - If possible, deduce other missing paths from the Device OS directory, otherwise, default them to
//   the current directory or fail.
function updateConfig(args) {
	// Device OS directory
	let deviceOsDir = args['device-os-dir'];
	if (deviceOsDir) {
		config.set('deviceOsDir', deviceOsDir);
	} else {
		deviceOsDir = config.get('deviceOsDir');
		if (!deviceOsDir) {
			deviceOsDir = detectedDeviceOsDirectory;
			if (deviceOsDir) {
				config.set('deviceOsDir', deviceOsDir);
			}
		}
	}
	// Test files directory
	let testDir = args['test-dir'];
	if (testDir) {
		config.set('testDir', testDir);
	} else {
		testDir = config.get('testDir');
		if (!testDir) {
			if (deviceOsDir) {
				testDir = `${deviceOsDir}/${DEFAULT_TEST_DIR}`;
			} else {
				throw new Error('Test directory is not specified');
			}
			config.set('testDir', testDir);
		}
	}
	// Firmware binaries directory
	const binaryDir = args['binary-dir'];
	if (binaryDir) {
		config.set('binaryDir', binaryDir);
	}
	// Build directory
	let buildDir = args['build-dir'];
	if (buildDir) {
		config.set('buildDir', buildDir);
	} else {
		buildDir = process.cwd();
		config.set('buildDir', buildDir);
	}
	// Run mode
	if (args['dry-run']) {
		config.set('runMode', RunMode.DRY_RUN);
	} else if (args['build']) {
		config.set('runMode', RunMode.BUILD);
	} else if (args['list-tests']) {
		config.set('runMode', RunMode.LIST_TESTS);
	} else if (args['list-fixtures']) {
		config.set('runMode', RunMode.LIST_FIXTURES);
	} else if (args['list-tags']) {
		config.set('runMode', RunMode.LIST_TAGS);
	} else if (args['version']) {
		config.set('runMode', RunMode.SHOW_VERSION);
	} else if (args['help']) {
		config.set('runMode', RunMode.SHOW_USAGE);
	}
	// Report file
	const reportFile = args['report'];
	if (reportFile) {
		config.set('reportFile', reportFile);
	}
	// Output format
	if (args['json']) {
		config.set('outputFormat', OutputFormat.JSON);
	}
	// Logging level
	if (args['verbose']) {
		config.set('logLevel', LogLevel.VERBOSE);
		config.set('verbose', true);
	}
}

function loadConfigFile(args) {
	let files = [];
	if (args.config) {
		files = args.config;
		if (!Array.isArray(files)) {
			files = [files];
		}
	} else {
		let dir = args['test-dir'];
		if (!dir) {
			dir = args['device-os-dir'] || detectedDeviceOsDirectory;
			if (dir) {
				dir = `${dir}/${DEFAULT_TEST_DIR}`;
			} else {
				dir = process.cwd();
			}
		}
		files = fg.sync('*' + CONFIG_FILE_SUFFIX, {
			cwd: dir,
			absolute: true,
			onlyFiles: true
		});
		files = files.sort();
	}
	files.forEach(file =>	config.loadFile(file));
}

/**
 * Load runner configuration.
 */
export async function initConfig() {
	// Parse command line arguments
	const args = parseCmdLine();
	// Try to find Device OS directory
	detectedDeviceOsDirectory = await findDeviceOsDirectory();
	// Load configuration file
	loadConfigFile(args);
	// Apply command line arguments
	updateConfig(args);
	// Load API credentials from the CLI's profile if necessary
	if ((!config.get('api.user') || !config.get('api.password')) && !config.get('api.token') && !loadCliProfile()) {
		throw new Error('Missing credentials for the Particle Cloud API');
	}
	config.validate({ allowed: 'strict' });
	return config;
}
