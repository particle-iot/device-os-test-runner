const { platformForId, isKnownPlatformId } = require('./platform');
const { config } = require('./config');

const Particle = require('particle-api-js');

const DEFAULT_EVENT_TIMEOUT = 30000;

/**
 * Particle Cloud API client.
 */
class ApiClient {
	constructor({ log }) {
		this._log = log; // Logger instance
		this._api = null; // API client
		this._token = null; // Access token
		this._user = null; // Username
		this._stream = null; // Event stream
		this._events = new Map(); // Received events
		this._handlers = new Map(); // Event handlers
		this._deviceIds = new Set(); // Devices under test
	}

	async init() {
		await this._signIn();
		await this._subscribe();
	}

	async shutdown() {
		if (this._stream) {
			this._stream.removeAllListeners('event');
			this._stream.removeAllListeners('error');
			this._stream.abort();
			this._stream = null;
		}
		if (this._api) {
			this._api = null;
		}
		this._deviceIds.clear();
	}

	async receiveEvent(name, opts = {}) {
		this._log.verbose(`Waiting cloud event: ${name}`);
		const h = {};
		const p = new Promise((resolve, reject) => {
			h.resolve = resolve;
			h.reject = reject;
		});
		const timeout = opts.timeout || DEFAULT_EVENT_TIMEOUT;
		h.timer = setTimeout(() => {
			if (h.reject) {
				h.reject(new Error('Event timeout'));
				h.resolve = null;
				h.reject = null;
			}
		}, timeout);
		let handlers = this._handlers.get(name);
		if (!handlers) {
			handlers = [];
			this._handlers.set(name, handlers);
		}
		handlers.push(h);
		this._notifyHandlers();
		return p;
	}

	setTestDevices(devices) {
		this._deviceIds = new Set(devices.map(dev => dev.id));
		this._events.clear();
		this._handlers.clear();
	}

	resetTestDevices() {
		this._deviceIds.clear();
		this._events.clear();
		this._handlers.clear();
	}

	async getDevices() {
		const devs = [];
		const r = await this._api.listDevices({ auth: this._token });
		for (const dev of r.body) {
			if (!isKnownPlatformId(dev.platform_id)) {
				this._log.debug(`Skipping device with an unsupported platform ID: ${dev.id}`);
				continue;
			}
			devs.push({
				id: dev.id,
				name: dev.name,
				platform: platformForId(dev.platform_id)
			});
		}
		return devs;
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

	async _subscribe() {
		this._log.verbose('Subscribing to device events');
		this._stream = await this._api.getEventStream({
			deviceId: 'mine',
			auth: this._token
		});
		this._stream.on('event', event => this._onEvent(event));
		this._stream.on('error', error => this._onError(error));
	}

	_onEvent(event) {
		if (!this._deviceIds.has(event.coreid)) {
			return;
		}
		let events = this._events.get(event.name);
		if (!events) {
			events = [];
			this._events.set(event.name, events);
		}
		events.push(event.data);
		this._notifyHandlers();
	}

	_notifyHandlers() {
		this._events.forEach((data, name, events) => {
			const handlers = this._handlers.get(name);
			if (handlers) {
				if (data.length) {
					let val = data[0];
					const intVal = Number.parseInt(val);
					if (!Number.isNaN(intVal)) {
						val = intVal;
					}
					let received = false;
					handlers.forEach(h => {
						if (h.resolve) {
							h.resolve(val);
							h.resolve = null;
							h.reject = null;
							clearTimeout(h.timer);
							received = true;
						}
					});
					if (received) {
						data.shift();
					}
				}
			}
			if (!data.length) {
				events.delete(name);
			}
		});
	}

	async _signIn() {
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
}

module.exports = {
	ApiClient
};
