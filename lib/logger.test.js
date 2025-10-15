'use strict';
// Warning: This test doesn't work because Logger is completely mocked out in ../test/index.js
// Ideally we'd change this so we can make assertions against the class itself

// const { expect, sinon } = require('../test');
// const { Logger, LogLevel } = require('./logger');
// const chalk = require('chalk');

describe('Logger', () => {
	// let logger;

	beforeEach(async () => {
		// logger = new Logger(LogLevel.SILLY);
	});

	afterEach(async () => {
		// sinon.restore();
	});

	// If Logger weren't mocked out this would be a nice test we'd like to run
	it('logs errors in red text');
	// , () => {
	// 	sinon.stub(chalk, 'red').returns('foo');
	// 	logger.error('HIHI');
	// 	expect(chalk.red).to.have.property('callCount', 1);
	// });

	it('logs warns in yellow text');
});
