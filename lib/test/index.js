const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinonChai = require('sinon-chai');
const _ = require('lodash');

chai.use(chaiAsPromised);
chai.use(sinonChai);

const { expect } = chai;

class Config {
	constructor() {
		this._params = {};
	}

	set(pathOrVal, val) {
		if (typeof pathOrVal === 'string') {
			_.set(this._params, pathOrVal, val);
		} else {
			this._params = pathOrVal;
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
		console.log('', ...arguments);
	}

	warn(/* ...args */) {
		console.log('', ...arguments);
	}

	info(/* ...args */) {
		console.log('', ...arguments);
	}

	verbose(/* ...args */) {
		console.log('', ...arguments);
	}

	debug(/* ...args */) {
		console.log('', ...arguments);
	}

	silly(/* ...args */) {
		console.log('', ...arguments);
	}

	log(/* level, ...args */) {
	}

	indent(/* count */) {
	}

	unindent(/* count */) {
	}
}

const log = new Logger();

module.exports = {
	expect,
	config,
	log
};
