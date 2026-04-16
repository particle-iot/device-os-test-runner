'use strict';

const Mocha = require('mocha');
const Spec = Mocha.reporters.Spec;
const constants = Mocha.Runner.constants;

const EVENT_TEST_PASS = constants.EVENT_TEST_PASS;
const EVENT_TEST_FAIL = constants.EVENT_TEST_FAIL;
const EVENT_TEST_PENDING = constants.EVENT_TEST_PENDING;
const EVENT_RUN_END = constants.EVENT_RUN_END;

class ReportReporter extends Spec {
	constructor(runner, options) {
		super(runner, options);
		let reportData = null;
		if (options) {
			const reporterOpts = options.reporterOptions || options.reporterOption;
			if (reporterOpts && reporterOpts.reportData) {
				reportData = reporterOpts.reportData;
			} else if (options.reportData) {
				reportData = options.reportData;
			}
		}
		this._reportData = reportData || { tests: [], start: null, end: null };

		runner.on(EVENT_TEST_PASS, (test) => {
			this._reportData.tests.push(test);
		});

		runner.on(EVENT_TEST_FAIL, (test) => {
			this._reportData.tests.push(test);
		});

		runner.on(EVENT_TEST_PENDING, (test) => {
			this._reportData.tests.push(test);
		});

		runner.on(EVENT_RUN_END, () => {
			if (!this._reportData.start) {
				this._reportData.start = new Date().toISOString();
			}
			this._reportData.end = new Date().toISOString();
		});
	}

	get reportData() {
		return this._reportData;
	}
}

module.exports = { ReportReporter };
