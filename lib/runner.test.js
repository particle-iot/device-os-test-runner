'use strict';
const { expect, config, log, fixturePath } = require('../test');
const proxyquire = require('proxyquire');
const { Runner } = proxyquire('../lib/runner', { './config': { config } });
const { ReportBuilder } = require('./report-builder');
const { RunMode } = require('./config');

const sinon = require('sinon');

describe('Runner', () => {
	let runner = null;

	beforeEach(() => {
		config.set({
			testDir: fixturePath(),
			runMode: RunMode.NORMAL,
			platforms: ['boron'],
			patterns: [],
			filters: []
		});
		runner = new Runner({ log });
	});

	afterEach(async () => {
		sinon.restore();
		await runner.shutdown();
		config.clear();
	});

	describe('init()', () => {
		it('loads test files', async () => {
			config.set('suiteRetries', 1);
			await runner.init();
			expect(runner.suites).to.containSubset([
				{
					title: 'suite_01',
					tests: [
						{ title: 'test_01' },
						{ title: 'test_02' }
					],
					particle: {
						suiteRetries: 1,
						platforms: [
							{ name: 'boron' }
						]
					}
				},
				{
					title: 'suite_02',
					tests: [
						{ title: 'test_01' },
						{ title: 'test_02' }
					],
					particle: {
						suiteRetries: 2,
						platforms: [
							{ name: 'boron' }
						]
					}
				}
			]);
		});
	});

	describe('_runWithSuiteRetries()', () => {
		it('retries a failed suite before continuing', async () => {
			runner._sourceSuites = [
				{ title: 'suite_01', particle: { file: 'suite_01/suite_01.spec.js', exclude: false, suiteRetries: 1 } },
				{ title: 'suite_02', particle: { file: 'suite_02/suite_02.spec.js', exclude: false, suiteRetries: 0 } }
			];
			const initRuntimeStub = sinon.stub(runner, '_initRuntime').resolves();
			const shutdownRuntimeStub = sinon.stub(runner, '_shutdownRuntime').resolves();
			const printRetrySummaryStub = sinon.stub(runner, '_printRetrySummary');
			const printSummaryStub = sinon.stub(runner, '_printSummary');
			const runSuitesStub = sinon.stub(runner, '_runSuites');
			const failure = Object.assign(new Error('test fail'), { title: 'test_01' });
			runSuitesStub.onCall(0).resolves({ ok: false, failures: [failure], reportData: null, stats: { passes: 0, failures: 1, pending: 0, duration: 1000 } });
			runSuitesStub.onCall(1).resolves({ ok: true, failures: [], reportData: null, stats: { passes: 1, failures: 0, pending: 0, duration: 500 } });
			runSuitesStub.onCall(2).resolves({ ok: true, failures: [], reportData: null, stats: { passes: 20, failures: 0, pending: 0, duration: 45000 } });

			const ok = await runner._runWithSuiteRetries();

			expect(ok).to.equal(true);
			expect(initRuntimeStub.callCount).to.equal(1);
			expect(shutdownRuntimeStub.callCount).to.equal(1);
			expect(runSuitesStub.getCalls().map(call => call.args[0][0].title)).to.deep.equal(['suite_01', 'suite_01', 'suite_02']);
			expect(printRetrySummaryStub.callCount).to.equal(1);
			expect(printRetrySummaryStub.firstCall.args[0]).to.have.length(1);
			expect(printRetrySummaryStub.firstCall.args[0][0].suite.title).to.equal('suite_01');
			expect(printSummaryStub.callCount).to.equal(1);
			expect(printSummaryStub.firstCall.args[0]).to.deep.equal({ passes: 21, failures: 0, pending: 0, duration: 45500 });
			expect(printRetrySummaryStub.firstCall.args[1]).to.have.length(1);
		});

		it('writes report when reportFile is configured and suite has retries', async () => {
			config.set('reportFile', '/tmp/test-report.json');
			runner._sourceSuites = [
				{ title: 'suite_01', particle: { file: 'suite_01/suite_01.spec.js', exclude: false, suiteRetries: 1 } }
			];
			sinon.stub(runner, '_initRuntime').resolves();
			sinon.stub(runner, '_shutdownRuntime').resolves();
			sinon.stub(runner, '_printRetrySummary');
			sinon.stub(runner, '_printSummary');
			const writeReportStub = sinon.stub(runner, '_writeReport');
			const runSuitesStub = sinon.stub(runner, '_runSuites');
			runSuitesStub.onCall(0).resolves({ ok: false, failures: [], reportData: { tests: [{ name: 't1', state: 'failed' }], start: '2026-04-16T10:00:00.000Z', end: '2026-04-16T10:00:10.000Z' }, stats: { passes: 0, failures: 1, pending: 0, duration: 10000 } });
			runSuitesStub.onCall(1).resolves({ ok: true, failures: [], reportData: { tests: [{ name: 't1', state: 'passed' }], start: '2026-04-16T10:00:10.000Z', end: '2026-04-16T10:00:20.000Z' }, stats: { passes: 1, failures: 0, pending: 0, duration: 5000 } });

			await runner._runWithSuiteRetries();

			expect(writeReportStub.callCount).to.equal(1);
			expect(writeReportStub.firstCall.args[0]).to.have.length(2);
		});
	});

	describe('_run()', () => {
		it('writes report when reportFile is configured', async () => {
			config.set('reportFile', '/tmp/test-report.json');
			sinon.stub(runner, '_initRuntime').resolves();
			sinon.stub(runner, '_shutdownRuntime').resolves();
			const writeReportStub = sinon.stub(runner, '_writeReport');
			sinon.stub(runner, '_runSuites').resolves({ ok: true, failures: [], reportData: { tests: [], start: '2026-04-16T10:00:00.000Z', end: '2026-04-16T10:00:10.000Z' }, stats: { passes: 0, failures: 0, pending: 0, duration: 0 } });

			await runner._run();

			expect(writeReportStub.callCount).to.equal(1);
		});

		it('does not write report when reportFile is not set', async () => {
			config.set('reportFile', '');
			sinon.stub(runner, '_initRuntime').resolves();
			sinon.stub(runner, '_shutdownRuntime').resolves();
			const writeReportStub = sinon.stub(runner, '_writeReport');
			sinon.stub(runner, '_runSuites').resolves({ ok: true, failures: [], reportData: null, stats: { passes: 0, failures: 0, pending: 0, duration: 0 } });

			await runner._run();

			expect(writeReportStub.callCount).to.equal(0);
		});
	});

	describe('ReportBuilder', () => {
		it('groups tests by device into the final structure', () => {
			const MochaSuite = require('mocha').Suite;
			const srcSuite = new MochaSuite('MySuite');
			srcSuite.particle = { file: 'my_suite/my_suite.spec.js', suiteRetries: 0 };
			const platSuite = new MochaSuite('boron');
			platSuite.particle = { platform: { name: 'boron' }, fixtures: [], file: 'my_suite/my_suite.spec.js' };
			const configSuite = new MochaSuite('systemThread=disabled');
			configSuite.particle = { platform: { name: 'boron' }, systemThread: 'disabled', systemMode: 'semi-automatic', file: 'my_suite/my_suite.spec.js' };
			configSuite.parent = platSuite;
			platSuite.parent = srcSuite;

			const allReportData = [{
				start: '2026-04-16T10:00:00.000Z',
				end: '2026-04-16T10:00:10.000Z',
				attempt: 1,
				tests: [{
					name: 'test_a',
					fullTitle: 'MySuite boron systemThread=disabled test_a',
					state: 'passed',
					duration: 500,
					parent: configSuite,
					particle: {
						suiteRetries: 0,
						devices: [{ id: 'dev1', name: 'boron-1', platform: 'boron' }]
					}
				}]
			}];

			const builder = new ReportBuilder();
			const report = builder.build(allReportData);

			expect(report.version).to.equal(1);
			expect(report.stats.tests).to.equal(1);
			expect(report.stats.passes).to.equal(1);
			expect(report.stats.failures).to.equal(0);
			expect(report.devices).to.have.length(1);
			expect(report.devices[0].id).to.equal('dev1');
			expect(report.devices[0].platform).to.equal('boron');
			expect(report.devices[0].suites).to.have.length(1);
			expect(report.devices[0].suites[0].name).to.equal('MySuite');
			expect(report.devices[0].suites[0].path).to.equal('my_suite');
			expect(report.devices[0].suites[0].configurations).to.have.length(1);
			expect(report.devices[0].suites[0].configurations[0].systemThread).to.equal('disabled');
			expect(report.devices[0].suites[0].configurations[0].attempts).to.have.length(1);
			expect(report.devices[0].suites[0].configurations[0].attempts[0].passed).to.equal(true);
		});
	});
});
