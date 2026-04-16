'use strict';
const { expect } = require('../test');
const { ReportReporter } = require('./reporter');
const Mocha = require('mocha');
const createStatsCollector = require('mocha/lib/stats-collector');

describe('ReportReporter', () => {
	let mocha;
	let runner;
	let suite;

	beforeEach(() => {
		mocha = new Mocha();
		suite = new Mocha.Suite('root', mocha.suite.ctx);
		runner = new Mocha.Runner(suite);
		createStatsCollector(runner);
	});

	afterEach(() => {
		runner = null;
		mocha = null;
	});

	it('collects passing test data', () => {
		const reportData = { tests: [], start: null, end: null };
		new ReportReporter(runner, { reportData });
		const parentSuite = new Mocha.Suite('parent suite');
		parentSuite.ctx = mocha.suite.ctx;
		suite.addSuite(parentSuite);
		const test = new Mocha.Test('test title');
		test.parent = parentSuite;
		test.state = 'passed';
		test.duration = 100;
		test.particle = {};
		runner.emit(Mocha.Runner.constants.EVENT_RUN_BEGIN);
		runner.emit(Mocha.Runner.constants.EVENT_TEST_PASS, test);
		runner.emit(Mocha.Runner.constants.EVENT_RUN_END);
		expect(reportData.tests).to.have.length(1);
		expect(reportData.tests[0].title).to.equal('test title');
		expect(reportData.tests[0].state).to.equal('passed');
		expect(reportData.tests[0].duration).to.equal(100);
	});

	it('collects failing test data with error', () => {
		const reportData = { tests: [], start: null, end: null };
		new ReportReporter(runner, { reportData });
		const parentSuite = new Mocha.Suite('parent suite');
		parentSuite.ctx = mocha.suite.ctx;
		suite.addSuite(parentSuite);
		const test = new Mocha.Test('failing test');
		test.parent = parentSuite;
		test.state = 'failed';
		test.duration = 200;
		test.particle = {};
		const err = new Error('something went wrong');
		test.err = err;
		runner.emit(Mocha.Runner.constants.EVENT_RUN_BEGIN);
		runner.emit(Mocha.Runner.constants.EVENT_TEST_FAIL, test, err);
		runner.emit(Mocha.Runner.constants.EVENT_RUN_END);
		expect(reportData.tests).to.have.length(1);
		expect(reportData.tests[0].state).to.equal('failed');
		expect(reportData.tests[0].err).to.have.property('message', 'something went wrong');
	});

	it('collects skipped test data', () => {
		const reportData = { tests: [], start: null, end: null };
		new ReportReporter(runner, { reportData });
		const parentSuite = new Mocha.Suite('parent suite');
		parentSuite.ctx = mocha.suite.ctx;
		suite.addSuite(parentSuite);
		const test = new Mocha.Test('skipped test');
		test.parent = parentSuite;
		test.state = 'skipped';
		test.particle = {};
		test.pending = true;
		runner.emit(Mocha.Runner.constants.EVENT_RUN_BEGIN);
		runner.emit(Mocha.Runner.constants.EVENT_TEST_PENDING, test);
		runner.emit(Mocha.Runner.constants.EVENT_RUN_END);
		expect(reportData.tests).to.have.length(1);
		expect(reportData.tests[0].state).to.equal('skipped');
	});

	it('records end time on run end', () => {
		const reportData = { tests: [], start: null, end: null };
		new ReportReporter(runner, { reportData });
		runner.emit(Mocha.Runner.constants.EVENT_RUN_BEGIN);
		runner.emit(Mocha.Runner.constants.EVENT_RUN_END);
		expect(reportData.end).to.be.a('string');
		expect(new Date(reportData.end).getTime()).to.be.at.most(Date.now() + 1000);
	});

	it('preserves particle metadata on test objects', () => {
		const reportData = { tests: [], start: null, end: null };
		new ReportReporter(runner, { reportData });
		const parentSuite = new Mocha.Suite('parent suite');
		parentSuite.ctx = mocha.suite.ctx;
		suite.addSuite(parentSuite);
		const test = new Mocha.Test('device test');
		test.parent = parentSuite;
		test.state = 'passed';
		test.duration = 50;
		test.particle = {
			devices: [{ id: 'abc123', name: 'boron-1', platform: { name: 'boron' } }],
			deviceTestName: 'device_test',
			suiteInitDuration: 500,
			suiteRetries: 2
		};
		runner.emit(Mocha.Runner.constants.EVENT_RUN_BEGIN);
		runner.emit(Mocha.Runner.constants.EVENT_TEST_PASS, test);
		runner.emit(Mocha.Runner.constants.EVENT_RUN_END);
		expect(reportData.tests[0].title).to.equal('device test');
		expect(reportData.tests[0].state).to.equal('passed');
		expect(reportData.tests[0].duration).to.equal(50);
		expect(reportData.tests[0].particle).to.deep.include({
			deviceTestName: 'device_test',
			suiteRetries: 2
		});
		expect(reportData.tests[0].particle.devices[0].id).to.equal('abc123');
	});

	it('inherits from Spec reporter', () => {
		const reportData = { tests: [], start: null, end: null };
		const reporter = new ReportReporter(runner, { reportData });
		expect(reporter).to.be.an.instanceof(Mocha.reporters.Spec);
	});
});
