export class Events {
	constructor({ apiClient, log }) {
		this._log = log;
		this._apiClient = apiClient;
		this._events = new Map();
		this._stream = null;
	}

	reset() {
		if (this._stream) {
			this._stream.abort();
		}
		this._events = new Map();
	}

	get apiClient() {
		return this._apiClient;
	}

	get log() {
		return this._log;
	}
}
