const chai = require('chai');
const chaiSubset = require('chai-subset');
const chaiAsPromised = require('chai-as-promised');
const sinonChai = require('sinon-chai');
const _ = require('lodash');

const path = require('path');

chai.use(chaiSubset);
chai.use(chaiAsPromised);
chai.use(sinonChai);

const { expect } = chai;
const sinon = require('sinon');

class Config {
	constructor() {
		this._params = {};
	}

	set(pathOrVal, val) {
		if (typeof pathOrVal === 'string') {
			_.set(this._params, pathOrVal, val);
		} else {
			_.merge(this._params, pathOrVal);
		}
	}

	get(path) {
		if (typeof path === 'string') {
			return _.get(this._params, path);
		} else {
			return this._params;
		}
	}

	clear() {
		this._params = {};
	}
}

const config = new Config();

class Logger {
	error(/* ...args */) {
	}

	warn(/* ...args */) {
	}

	info(/* ...args */) {
	}

	verbose(/* ...args */) {
	}

	debug(/* ...args */) {
	}

	silly(/* ...args */) {
	}

	log(/* level, ...args */) {
	}

	indent(/* count */) {
	}

	unindent(/* count */) {
	}
}

const log = new Logger();

function fixturePath(...subDirs) {
	let p = path.join(__dirname, 'fixtures');
	if (subDirs) {
		p = path.join(p, ...subDirs);
	}
	return p;
}

module.exports = {
	expect,
	sinon,
	config,
	log,
	fixturePath
};
