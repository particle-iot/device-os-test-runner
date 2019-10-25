import { config } from './config';

import Particle from 'particle-api-js';

/**
 * Particle Cloud API client.
 */
export class ApiClient {
	constructor({ log }) {
		this._log = log; // Logger instance
		this._api = null; // API client
		this._token = null; // Access token
		this._user = null; // Username
	}

	async init() {
		this._api = new Particle({ baseUrl: config.get('api.url') });
		this._log.verbose(`URL: ${this._api.baseUrl}`);
		this._token = config.get('api.token');
		if (!this._token) {
			this._log.verbose('Authenticating with username/password');
			this._user = config.get('api.user');
			const r = await this._api.login({
				username: this._user,
				password: config.get('api.password'),
				tokenDuration: Math.floor(config.get('api.tokenDuration') / 1000)
			});
			this._token = r.body.access_token;
		} else {
			this._log.verbose('Authenticating with access token');
			const r = await this._api.getUserInfo({ auth: this._token });
			this._user = r.body.username;
		}
		this._log.verbose(`Signed in as ${this._user}`);
	}

	async shutdown() {
		if (this._api) {
			this._api = null;
		}
	}

	async getDevices() {
		const r = await this._api.listDevices({ auth: this._token });
		return r.body.map(({ id, name }) => ({ id, name }));
	}

	get user() {
		return this._user;
	}

	get token() {
		return this._token;
	}

	get instance() {
		return this._api;
	}
}
