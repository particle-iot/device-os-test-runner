import { platformsForTag } from './platform';
import { SpecError, InternalError, isInternalError } from './error';

import chai from 'chai';

// All exports of this module are accessible from test modules globally

export const expect = chai.expect;

function suiteConfigFn(name, fn) {
	return (...args) => {
		const particle = global.particle;
		if (!particle) {
			throw new InternalError('Global context is not initialized');
		}
		const suite = particle.currentSuite;
		if (!suite) {
			throw new SpecError(`${name}() is called outside of a test suite`, particle.currentFile);
		}
		if (!suite.particle) {
			throw new InternalError('Suite context is not initialized');
		}
		let config = suite.particle.config;
		if (!config) {
			config = {};
			suite.particle.config = config;
		}
		try {
			fn(config, ...args);
		} catch (e) {
			if (!(e instanceof SpecError) && !isInternalError(e)) {
				throw new SpecError(e.message, particle.currentFile);
			}
			throw e;
		}
	}
}

const SYSTEM_MODES = new Set(['default', 'automatic', 'semi-automatic', 'manual', 'safe-mode']);
const SYSTEM_THREAD_MODES = new Set(['enabled', 'disabled']);

// Configures target platforms of the current test suite
export const platform = suiteConfigFn('platform', (config, ...tags) => {
	if (tags.length) {
		if (!config.platforms) {
			config.platforms = new Map();
		}
		tags.forEach(tag => {
			const ps = platformsForTag(tag);
			ps.forEach(p => config.platforms.set(p.id, p));
		});
	}
});

platform.exclude = suiteConfigFn('platform.exclude', (config, ...tags) => {
	if (tags.length && config.platforms) {
		tags.forEach(tag => {
			const ps = platformsForTag(tag);
			ps.forEach(p => config.platforms.delete(p.id));
		});
	}
});

// Configures system modes of the current test suite
export const systemMode = suiteConfigFn('systemMode', (config, ...modes) => {
	if (modes.length) {
		if (!config.systemModes) {
			config.systemModes = new Set();
		}
		modes.forEach(mode => {
			if (!SYSTEM_MODES.has(mode)) {
				throw new Error(`Invalid system mode: ${mode}`);
			}
			config.systemModes.add(mode);
		});
	}
});

// Configures threading modes of the current test suite
export const systemThread = suiteConfigFn('systemThread', (config, ...modes) => {
	if (modes.length) {
		if (!config.systemThreadModes) {
			config.systemThreadModes = new Set();
		}
		modes.forEach(mode => {
			if (!SYSTEM_THREAD_MODES.has(mode)) {
				throw new Error(`Invalid threading mode: ${mode}`);
			}
			config.systemThreadModes.add(mode);
		});
	}
});

// Assigns a set of tags to the current test suite
export const tag = suiteConfigFn('tag', (config, ...tags) => {
	if (tags.length) {
		if (!config.tags) {
			config.tags = new Set();
		}
		tags.forEach(tag => config.tags.add(tag));
	}
});

export const fixture = suiteConfigFn('fixture', (config, ...fixtures) => {
	if (fixtures.length) {
		if (!config.fixtures) {
			config.fixtures = [];
		}
		fixtures.forEach(f => {
			if (typeof f === 'string') {
				config.fixtures.push({ name: f, app: f });
			} else {
				if (!f.name) {
					throw new Error('Fixture name is missing');
				}
				config.fixtures.push(f);
			}
		});
	}
});
