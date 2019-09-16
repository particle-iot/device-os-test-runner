/**
 * Test context.
 */
export class Test {
	constructor({ parent, log }) {
		this._log = log;
		this._parent = parent;
	}

	async init() {
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
