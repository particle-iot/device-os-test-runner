import { LOG_LEVELS } from './logger';

import convict from 'convict';

import * as fs from 'fs';
import * as os from 'os';

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
			platforms: {
				doc: 'Supported platforms',
				format: 'array',
				elements: String,
				default: []
			},
			devices: {
				doc: 'Devices',
				format: 'array',
				elements: String,
				default: []
			}
		}
	},
	deviceOs: {
		path: {
			doc: 'Path to Device OS source',
			format: String,
			default: '',
			env: 'DEVICE_OS'
		}
	},
	build: {
		path: {
			doc: 'Path to build directory',
			format: String,
			default: '',
			env: 'BUILD_PATH'
		}
	},
	api: {
		url: {
			doc: 'API URL',
			format: 'url',
			default: 'https://api.particle.io',
			env: 'API_URL'
		},
		username: {
			doc: 'API username',
			format: String,
			default: '',
			env: 'API_USERNAME'
		},
		password: {
			doc: 'API password',
			format: String,
			default: '',
			sensitive: true
		},
		token: {
			doc: 'API token',
			format: String,
			default: '',
			sensitive: true
		},
		tokenDuration: {
			doc: 'API token duration',
			format: 'duration',
			default: '4 hours',
			env: 'API_TOKEN_DURATION'
		}
	},
	log: {
		level: {
			doc: 'Logging level',
			format: Object.keys(LOG_LEVELS),
			default: 'warn',
			env: 'LOG_LEVEL'
		}
	},
	config: {
		doc: 'Configuration file',
		format: String,
		default: 'config.json',
		env: 'CONFIG'
	}
});

function loadCliProfile() {
	let profileName = 'particle';
	// Get the name of the active profile from ~/.particle/profile.json
	let profileFile = `${os.homedir()}/.particle/profile.json`;
	if (fs.statSync(profileFile).isFile()) {
		const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
		if (profile.name) {
			profileName = profile.name;
		}
	}
	profileFile = `${os.homedir()}/.particle/${profileName}.config.json`;
	if (fs.statSync(profileFile).isFile()) {
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

/**
 * Load runner configuration.
 */
export function loadConfig() {
	const file = config.get('config');
	config.loadFile(file);
	if ((!config.get('api.username') || !config.get('api.password')) && !config.get('api.token') && !loadCliProfile()) {
		throw new Error('Missing credentials for the Particle Cloud API');
	}
	config.validate({ allowed: 'strict' });
	return config;
}
