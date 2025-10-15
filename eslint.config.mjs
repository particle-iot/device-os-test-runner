import { particle } from 'eslint-config-particle';
import globals from './lib/globals.js';

export default [
	{
		name: 'Add globals',
		languageOptions: {
			// See lib/globals and lib/runner: Runner::_registerGlobals
			globals: Object.fromEntries(
				Object.keys(globals).map((k) => [k, true])
			)
		}
	},
	...particle({
		rootDir: import.meta.dirname,
		testGlobals: 'mocha',
		overrides: {
			'no-console': 'off'
		}
	})
];
