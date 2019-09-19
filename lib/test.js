/**
 * Test context.
 */
export class Test {
	constructor({ device, parent, log }) {
		this._log = log;
		this._parent = parent;
		this._device = device;
	}

	async init() {
	}

	get device() {
		return this._device;
	}

	get parent() {
		return this._parent;
	}

	// FIXME: Move to a base class
	get runner() {
		let p = this._parent;
		while (!(p instanceof Runner)) {
			if (!p) {
				throw new Error('Unable to get runner object');
			}
			p = p.parent;
		}
		return p;
	}

	get log() {
		return this._log;
	}
}
