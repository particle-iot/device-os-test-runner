import { config } from './config';

import Particle from 'particle-api-js';

/**
 * Particle Cloud API client.
 */
export class ApiClient {
	constructor({ log }) {
		this._log = log;
		this._api = new Particle({ baseUrl: config.get('api.url')	});
		this._token = config.get('api.token');
		this._username = null;
	}

	async init() {
		this._log.verbose(`URL: ${this._api.baseUrl}`);
		if (!this._token) {
			this._log.verbose('Authenticating using username/password');
			this._username = config.get('api.username');
			const r = await this._api.login({
				username: this._username,
				password: config.get('api.password'),
				tokenDuration: Math.floor(config.get('api.tokenDuration') / 1000)
			});
			this._token = r.body.access_token;
		} else {
			this._log.verbose('Authenticating using access token');
			const r = await this._api.getUserInfo({ auth: this._token });
			this._username = r.body.username;
		}
		this._log.verbose(`Signed in as ${this._username}`);
	}

	async getDevices() {
		const r = await this._api.listDevices({ auth: this._token });
		return r.body.map(({ id, name }) => ({ id, name }));
	}

	get particle() {
		return this._api;
	}

	get username() {
		return this._username;
	}

	get token() {
		return this._token;
	}

	get log() {
		return this._log;
	}
}
