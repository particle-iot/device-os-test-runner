import { LOG_LEVELS } from './logger';

import convict from 'convict';

import * as fs from 'fs';
import * as os from 'os';

convict.addFormat({
	name: 'string_array',
	validate: strings => {
		if (!Array.isArray(strings) || !strings.every(s => typeof s === 'string')) {
			throw new Error('Expected an array of strings');
		}
	}
});

convict.addFormat({
	name: 'object_array',
	validate: (objects, schema) => {
		if (!Array.isArray(objects)) {
			throw new Error('Expected an array of objects');
		}
		objects.forEach(object => {
			convict(schema.children).load(object).validate();
		});
	}
});

export const config = convict({
	devices: {
		doc: 'Device pool',
		format: 'string_array',
		default: []
	},
	fixtures: {
		doc: 'Device fixtures',
		format: 'object_array',
		default: [],
		children: {
			name: {
				doc: 'Fixture name',
				format: String,
				default: ''
			},
			devices: {
				doc: 'Devices',
				format: 'string_array',
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
