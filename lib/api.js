'use strict';
const { platformForId, isKnownPlatformId } = require('./platform');
const { config } = require('./config');
const { delay } = require('./util');

const Particle = require('particle-api-js');
const crypto = require('crypto');

const DEFAULT_EVENT_TIMEOUT = 30000;
const KEEPALIVE_EVENT_NAME = 'device-os-test/keepalive';
const KEEPALIVE_INTERVAL = 15000;
const KEEPALIVE_TIMEOUT = 10000;

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
		this._instanceId = crypto.randomBytes(8).toString('hex'); // Distinguishes this runner from others
		this._keepAliveTimer = null; // Keepalive timer
		this._keepAlivePending = null; // Keepalive awaiting echo from the event stream
		this._nextKeepAliveNonce = 1; // Monotonic keepalive nonce
		this._reconnectPromise = null; // Active reconnect attempt
	}

	async init() {
		await this._signIn();
		await this._subscribe();
		this._startKeepAlive();
	}

	async shutdown() {
		this._stopKeepAlive();
		this._closeStream();
		if (this._api) {
			this._api = null;
		}
		this._deviceIds.clear();
		this._keepAlivePending = null;
		this._reconnectPromise = null;
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

	async publishEvent({ name, data, retries = 1, retryDelay = 1000 } = {}) {
		for (;;) {
			try {
				await this._api.publishEvent({ name, data, auth: this._token });
				break;
			} catch (err) {
				if (retries <= 0) {
					throw err;
				}
				this._log.warn(`Failed to publish event: ${err.message}\nRetrying in ${retryDelay}ms`);
				await delay(retryDelay);
				retryDelay *= 2;
				--retries;
			}
		}
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
		this._stream.on('event', (event) => this._onEvent(event));
		this._stream.on('error', (err) => {
			this._log.error(`Event stream error: ${err.message}`);
		});
		this._stream.on('reconnect', () => {
			this._log.warn('Event stream is reconnecting');
		});
		this._stream.on('reconnect-success', () => {
			this._log.info('Event stream reconnected');
		});
		this._stream.on('reconnect-error', (err) => {
			this._log.error(`Event stream failed to reconnect: ${err.message}`);
		});
	}

	_onEvent(event) {
		if (event.name === KEEPALIVE_EVENT_NAME) {
			this._handleKeepAliveEvent(event);
			return;
		}
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

	_handleKeepAliveEvent(event) {
		let data = null;
		try {
			data = JSON.parse(event.data);
		} catch (_err) {
			return;
		}
		if (!data || data.instanceId !== this._instanceId) {
			return;
		}
		if (this._keepAlivePending && data.nonce === this._keepAlivePending.nonce) {
			this._keepAlivePending = null;
		}
	}

	_startKeepAlive() {
		this._stopKeepAlive();
		this._scheduleKeepAlive();
	}

	_stopKeepAlive() {
		if (this._keepAliveTimer) {
			clearTimeout(this._keepAliveTimer);
			this._keepAliveTimer = null;
		}
	}

	_scheduleKeepAlive(delayMs = KEEPALIVE_INTERVAL) {
		this._stopKeepAlive();
		this._keepAliveTimer = setTimeout(() => {
			this._keepAliveTimer = null;
			this._runKeepAliveCycle();
		}, delayMs);
	}

	async _runKeepAliveCycle() {
		try {
			if (this._reconnectPromise) {
				return;
			}
			if (this._keepAlivePending) {
				if (Date.now() - this._keepAlivePending.sentAt >= KEEPALIVE_TIMEOUT) {
					this._log.warn('Event stream keepalive timed out; reconnecting');
					await this._reconnectStream('keepalive timeout');
				}
				return;
			}
			this._keepAlivePending = {
				instanceId: this._instanceId,
				nonce: this._nextKeepAliveNonce++,
				sentAt: Date.now()
			};
			await this.publishEvent({
				name: KEEPALIVE_EVENT_NAME,
				data: JSON.stringify({
					instanceId: this._keepAlivePending.instanceId,
					nonce: this._keepAlivePending.nonce
				}),
				retries: 0
			});
		} catch (err) {
			this._log.warn(`Event stream keepalive failed: ${err.message}`);
			await this._reconnectStream('keepalive publish failed');
		} finally {
			this._scheduleKeepAlive();
		}
	}

	async _reconnectStream(reason) {
		if (this._reconnectPromise) {
			return this._reconnectPromise;
		}
		this._reconnectPromise = (async () => {
			this._log.warn(`Reconnecting event stream: ${reason}`);
			this._keepAlivePending = null;
			this._closeStream();
			await this._subscribe();
		})().finally(() => {
			this._reconnectPromise = null;
		});
		return this._reconnectPromise;
	}

	_closeStream() {
		if (this._stream) {
			this._stream.removeAllListeners('event');
			this._stream.removeAllListeners('error');
			this._stream.removeAllListeners('reconnect');
			this._stream.removeAllListeners('reconnect-success');
			this._stream.removeAllListeners('reconnect-error');
			this._stream.abort();
			this._stream = null;
		}
	}

	_notifyHandlers() {
		this._events.forEach((data, name, events) => {
			const handlers = this._handlers.get(name);
			if (handlers) {
				if (data.length) {
					const d = data[0];
					let received = false;
					handlers.forEach(h => {
						if (h.resolve) {
							h.resolve(d);
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
