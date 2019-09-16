import { ApiClient } from './api_client';
import { Devices } from './device';

/**
 * Test runner context.
 */
export class Runner {
	constructor({ log }) {
		this._log = log;
		this._api = new ApiClient({ log: this._log });
		this._devices = new Devices({ apiClient: this._api, log: this._log });
	}

	async init() {
		this._log.info('Initializing API client');
		await this._api.init();
		this._log.info('Initializing device manager');
		await this._devices.init();
	}

	get devices() {
		return this._devices;
	}

	get apiClient() {
		return this._api;
	}

	get log() {
		return this._log;
	}
}
