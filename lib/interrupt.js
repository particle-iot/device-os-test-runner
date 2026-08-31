'use strict';

/**
 * Test files and their helpers may install signal listeners that don't
 * terminate the process, which disables Node's default behavior and makes
 * the runner ignore Ctrl-C. This handler is installed before test files are
 * loaded and guarantees termination after a best-effort cleanup.
 */
class InterruptHandler {
	constructor({ exit = (signal) => process.kill(process.pid, signal) } = {}) {
		this._exit = exit;
		this._shutdown = null;
		this._handling = false;
		this._onSignal = this._onSignal.bind(this);
	}

	install(shutdown = null) {
		this._shutdown = shutdown;
		this.uninstall();
		process.on('SIGINT', this._onSignal);
		process.on('SIGTERM', this._onSignal);
	}

	uninstall() {
		process.removeListener('SIGINT', this._onSignal);
		process.removeListener('SIGTERM', this._onSignal);
	}

	async _onSignal(signal) {
		if (!this._handling) {
			this._handling = true;
			console.error(`\nReceived ${signal}, terminating`);
			try {
				if (this._shutdown) {
					await this._shutdown();
				}
			} catch {
				// Best-effort cleanup
			}
		}
		process.removeAllListeners(signal);
		this._exit(signal);
	}
}

module.exports = {
	InterruptHandler
};
