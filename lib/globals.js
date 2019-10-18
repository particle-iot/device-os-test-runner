import { parsePlatforms } from './platform';
import { SpecError, InternalError } from './error';

import chai from 'chai';

// All exports of this module are globally accessible within a test module

function contextFunction(fn) {
	const ctxFn = ctx => {
		if (!ctx) {
			throw new InternalError('Invalid context object');
		}
		return (...args) => fn(ctx, ...args);
	};
	// This flag tells the runner that this function takes a context object and returns a new function
	ctxFn.needsContext = true;
	return ctxFn;
}

function suiteFunction(name, fn) {
	return contextFunction((ctx, ...args) => {
		const errMsg = `${name}() is called outside of a test suite`;
		if (!ctx.particle) {
			throw new InternalError(errMsg);
		}
		if (!ctx.particle.currentSuite) {
			throw new SpecError(ctx.particle.specFile, errMsg);
		}
		fn(ctx.particle.currentSuite, ...args);
	});
}

function suiteConfig(suite) {
	let config = suite.particle.config;
	if (!config) {
		config = {};
		suite.particle.config = config;
	}
	return config;
}

const SYSTEM_MODES = new Set(['default', 'automatic', 'semi-automatic', 'manual', 'safe-mode']);
const SYSTEM_THREAD_MODES = new Set(['enabled', 'disabled']);

export const expect = chai.expect;

// Configures target platforms of the current test suite
export const platform = suiteFunction('platform', (suite, ...platforms) => {
	if (!platforms.length) {
		return;
	}
	const config = suiteConfig(suite);
	if (!config.platforms) {
		config.platforms = new Map();
	}
	const ps = parsePlatforms(platforms);
	ps.forEach(p => config.platforms.set(p.id, p));
});

// Excludes specified platforms from the list of target platforms
export const excludePlatform = suiteFunction('excludePlatform', (suite, ...platforms) => {
	if (!platforms.length) {
		return;
	}
	const config = suiteConfig(suite);
	if (config.platforms) {
		const ps = parsePlatforms(platforms);
		ps.forEach(p => config.platforms.delete(p.id));
	}
});

// Configures system modes of the current test suite
export const systemMode = suiteFunction('systemMode', (suite, ...modes) => {
	if (!modes.length) {
		return;
	}
	const config = suiteConfig(suite);
	if (!config.systemModes) {
		config.systemModes = new Set();
	}
	modes.forEach(mode => {
		if (!SYSTEM_MODES.has(mode)) {
			throw new SpecError(suite.particle.specFile, `Invalid system mode: ${mode}`);
		}
		config.systemModes.add(mode);
	});
});

// Configures threading modes of the current test suite
export const systemThread = suiteFunction('systemThread', (suite, ...modes) => {
	if (!modes.length) {
		return;
	}
	const config = suiteConfig(suite);
	if (!config.systemThreadModes) {
		config.systemThreadModes = new Set();
	}
	modes.forEach(mode => {
		if (!SYSTEM_THREAD_MODES.has(mode)) {
			throw new SpecError(suite.particle.specFile, `Invalid threading mode: ${mode}`);
		}
		config.systemThreadModes.add(mode);
	});
});

// Assigns a set of tags to the current test suite
export const tag = suiteFunction('tag', (suite, ...tags) => {
	if (!tags.length) {
		return;
	}
	let tagSet = suite.particle.tags;
	if (!tagSet) {
		tagSet = new Set();
		suite.particle.tags = tagSet;
	}
	tags.forEach(t => tagSet.add(t));
});
