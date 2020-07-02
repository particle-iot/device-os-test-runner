const { LogLevel } = require('./logger');
const { findDeviceOsDirectory } = require('./util');
const { description: PACKAGE_DESCRIPTION } = require('../package.json');

const convict = require('convict');
const parseArgs = require('minimist');
const substitute = require('shellsubstitute');
const fg = require('fast-glob');

const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_FILE_SUFFIX = '.config.json';
const DEFAULT_TEST_DIR = 'user/tests/integration'; // Relative to the Device OS directory

let detectedDeviceOsDir = null;

/**
 * Application name.
 */
const APP_NAME = path.basename(process.argv[1]);

/**
 * Run mode.
 */
const RunMode = {
	NORMAL: 'normal',
	DRY_RUN: 'dry-run',
	BUILD: 'build',
	LIST_TESTS: 'list-tests',
	LIST_FIXTURES: 'list-fixtures',
	LIST_TAGS: 'list-tags',
	COMBINE_REPORTS: 'combine-reports',
	SHOW_VERSION: 'show-version',
	SHOW_USAGE: 'show-usage'
};

/**
 * Output format.
 */
const OutputFormat = {
	TEXT: 'text',
	JSON: 'json'
};

convict.addFormat({
	name: 'object-array',
	validate: (array, schema) => {
		if (!Array.isArray(array)) {
			throw new Error('Expected an array');
		}
		array.forEach(elem => {
			convict(schema.elements).load(elem).validate({ allowed: 'strict' });
		});
	}
});

convict.addFormat({
	name: 'string-array',
	validate: (array, schema) => {
		if (!Array.isArray(array) || !array.every(elem => typeof elem === 'string')) {
			throw new Error('Expected an array of strings');
		}
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
// TODO: Don't use the config object as a singleton
const config = convict({
	devices: {
		doc: 'Device pool',
		format: 'string-array',
		default: []
	},
	platforms: {
		doc: 'Enabled platforms',
		format: 'string-array',
		default: []
	},
	fixtures: {
		doc: 'Device fixtures',
		format: 'object-array',
		default: [],
		elements: {
			name: {
				doc: 'Fixture name',
				format: String,
				default: ''
			},
			devices: {
				doc: 'Devices',
				format: 'string-array',
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
		format: 'string-array',
		default: []
	},
	patterns: {
		doc: 'Test name patterns',
		format: 'string-array',
		default: []
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
	targetDir: {
		doc: 'Target directory',
		format: String,
		default: ''
	},
	reportFile: {
		doc: 'Target report file',
		format: String,
		default: ''
	},
	reportFiles: {
		doc: 'Source report files',
		format: 'string-array',
		default: []
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

function showUsage() {
	console.log(`\
${PACKAGE_DESCRIPTION}

Usage: ${APP_NAME} <command> [options...]

Commands:

run [--test-dir=DIR] [--device-os-dir=DIR] [--binary-dir=DIR] [--report-file=FILE] [--dry] [filters...]
    Run tests.

list [--fixtures|--tags] [--json] [filters...]
    List tests.

build [--test-dir=DIR] [--device-os-dir=DIR] [--target-dir=DIR] [filters...]
    Build application binaries.

report [--combine] <files...>
    Process report files.

Options:

-c FILE, --config-file=FILE
    Specify the configuration file.

--test-dir=DIR
    Specify the test directory.

--device-os-dir=DIR
    Specify the Device OS directory.

--binary-dir=DIR
    Specify the directory containing application binaries.

--target-dir=DIR
    Specify the target directory.

--fixtures
    List all fixtures.

--tags
    List all known tags.

--json
    Use JSON as the output format.

-r FILE, --report-file=FILE
    Generate a report in the JSON format and save it to the file.

--combine
    Generate a combined report.

--dry
    Verify the configuration and skip all tests.

-v, --verbose
    Enable verbose logging.

--version
    Show the version number.

-h, --help
    Show this message.

Examples:

${APP_NAME} run
    Run all tests.

${APP_NAME} run communication/events
    Run tests in the specified directory.

${APP_NAME} run photon p1
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

// TODO: Describe command-specific arguments separately
function parseCmdLine() {
	return parseArgs(process.argv.slice(2), {
		string: ['_', 'grep', 'config-file', 'test-dir', 'binary-dir', 'device-os-dir', 'target-dir', 'report-file'],
		boolean: ['build', 'dry', 'fixtures', 'tags', 'combine', 'version', 'help', 'json', 'verbose'],
		alias: {
			'grep': 'g',
			'config-file': 'c',
			'report-file': 'r',
			'verbose': 'v',
			'help': 'h'
		},
		unknown: arg => {
			if (arg.startsWith('-')) {
				throw new RangeError(`Unknown argument: ${arg}`);
			}
		}
	});
}

// This function combines all parameters into the global config object:
// - Parameters passed via the command line take precedence.
// - If the Device OS directory is not specified, try to determine it based on the current directory.
// - If possible, deduce other missing paths from the Device OS directory, otherwise, default them to
//   the current directory or fail.
function updateConfig(args) {
	// Run mode
	let runMode = null;
	const cmd = args['_'].shift();
	switch (cmd) {
		case 'run': {
			if (args['dry']) {
				runMode = RunMode.DRY_RUN;
			} else {
				runMode = RunMode.NORMAL;
			}
			const filters = args['_'];
			if (filters.length) {
				config.set('filters', filters);
			}
			let patterns = args['grep'];
			if (patterns) {
				if (!Array.isArray(patterns)) {
					patterns = [patterns];
				}
				config.set('patterns', patterns);
			}
			break;
		}
		case 'list': {
			if (args['fixtures']) {
				runMode = RunMode.LIST_FIXTURES;
			} else if (args['tags']) {
				runMode = RunMode.LIST_TAGS;
			} else {
				runMode = RunMode.LIST_TESTS;
			}
			const filters = args['_'];
			if (filters.length) {
				config.set('filters', filters);
			}
			break;
		}
		case 'build': {
			runMode = RunMode.BUILD;
			const filters = args['_'];
			if (filters.length) {
				config.set('filters', filters);
			}
			break;
		}
		case 'report': {
			runMode = RunMode.COMBINE_REPORTS;
			const files = args['_'];
			if (files.length) {
				config.set('reportFiles', files);
			}
			break;
		}
		default: {
			throw new Error(`Unknown command: ${cmd}`);
		}
	}
	config.set('runMode', runMode);
	// Device OS directory
	let deviceOsDir = args['device-os-dir'];
	if (deviceOsDir) {
		config.set('deviceOsDir', deviceOsDir);
	} else {
		deviceOsDir = config.get('deviceOsDir');
		if (!deviceOsDir) {
			deviceOsDir = detectedDeviceOsDir;
			if (deviceOsDir) {
				config.set('deviceOsDir', deviceOsDir);
			}
		}
	}
	// Test directory
	let testDir = args['test-dir'];
	if (testDir) {
		config.set('testDir', testDir);
	} else {
		testDir = config.get('testDir');
		if (!testDir) {
			if (deviceOsDir) {
				testDir = path.join(deviceOsDir, DEFAULT_TEST_DIR);
			} else {
				throw new Error('Test directory is not specified');
			}
			config.set('testDir', testDir);
		}
	}
	// Target directory
	let targetDir = args['target-dir'];
	if (targetDir) {
		config.set('targetDir', targetDir);
	}
	// Binaries directory
	const binaryDir = args['binary-dir'];
	if (binaryDir) {
		config.set('binaryDir', binaryDir);
	}
	// Target report file
	const reportFile = args['report-file'];
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

function loadConfigFiles(args) {
	let files = args['config-file'];
	if (!files) {
		let dir = args['test-dir'];
		if (!dir) {
			dir = args['device-os-dir'] || detectedDeviceOsDir;
			if (dir) {
				dir = path.join(dir, DEFAULT_TEST_DIR);
			} else {
				dir = process.cwd();
			}
		}
		files = fg.sync('*' + CONFIG_FILE_SUFFIX, {
			cwd: dir,
			absolute: true,
			onlyFiles: true
		});
		files.sort();
	}
	config.loadFile(files);
}

/**
 * Load runner configuration.
 */
async function initConfig() {
	// Parse command line arguments
	const args = parseCmdLine();
	if (args['version']) {
		config.set('runMode', RunMode.SHOW_VERSION)
	} else if (args['help'] || !args['_'].length) {
		config.set('runMode', RunMode.SHOW_USAGE)
	} else {
		// Try to find Device OS directory
		detectedDeviceOsDir = await findDeviceOsDirectory();
		// Load configuration files
		loadConfigFiles(args);
		// Apply command line arguments
		updateConfig(args);
		// Load API credentials from the CLI's profile if necessary
		if ((!config.get('api.user') || !config.get('api.password')) && !config.get('api.token') && !loadCliProfile()) {
			throw new Error('Missing credentials for the Particle Cloud API');
		}
	}
	config.validate({ allowed: 'strict' });
	return config;
}

module.exports = {
	APP_NAME,
	RunMode,
	OutputFormat,
	config,
	showUsage,
	initConfig
};
