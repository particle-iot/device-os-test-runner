module.exports = {
	extends: ['eslint-config-particle'],
	parserOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module'
	},
	rules: {
		'max-len': 'warn'
	},
	ignorePatterns: ['examples'],
	root: true
};
