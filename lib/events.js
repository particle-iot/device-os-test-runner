export class Events {
	constructor({ apiClient, log }) {
		this._log = log;
		this._api = apiClient;
		this._events = new Map();
		this._listeners = new Map();
		this._stream = null;
		this._error = null;
	}

	async init() {
		this._log.verbose('Subscribing to device events');
		this._stream = await this._api.particle.getEventStream({
			deviceId: 'mine',
			auth: this._api.token
		});
		this._stream.on('event', event => this._onEvent(event));
		this._stream.on('error', error => this._onError(error));
	}

	async shutdown() {
		if (this._stream) {
			this._stream.removeAllListeners('event');
			this._stream.removeAllListeners('error');
			this._stream.abort();
			this._stream = null;
		}
	}

	async receive(event) {
		if (this._error) {
			throw this._error;
		}
		return new Promise((resolve, reject) => {
			// TODO: Set a timeout
			this._listeners.set(event, { resolve, reject });
		});
	}

	reset() {
		this._events.clear();
		this._error = null;
		const listeners = Array.from(this._listeners.values());
		this._listeners.clear();
		listeners.forEach(l => l.reject(new Error('Cancelled')));
	}

	get apiClient() {
		return this._api;
	}

	get log() {
		return this._log;
	}

	_onEvent(event) {
		const events = this._events.get(event.name);
		if (!events) {
			events = [];
			this._events.set(event.name, events);
		}
		events.push(event);
		console.dir(event);
	}

	_onError(error) {
		this._log.error(err.message);
		const listeners = Array.from(this._listeners.values());
		this._listeners.clear();
		listeners.forEach(l => l.reject(error));
		this.reset();
		this._error = error;
	}
}
