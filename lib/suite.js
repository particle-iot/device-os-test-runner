import { Runner } from './runner';
import { platformsForTag, PLATFORMS } from './platform';

/**
 * Test suite context.
 */
export class Suite {
	constructor({ path, parent, log }) {
		this._log = log;
		this._parent = parent;
		this._path = path;
		this._platforms = [];
	}

	setPlatforms(platforms) {
		this._platforms = platforms;
	}

	get platforms() {
		return this._platforms;
	}

	get path() {
		return this._path;
	}

	get parent() {
		return this._parent;
	}

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
