'use strict';
const { expect, config, log, fixturePath } = require('../test');
const proxyquire = require('proxyquire');
const { Runner } = proxyquire('../lib/runner', { './config': { config } });
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
			const runSuitesStub = sinon.stub(runner, '_runSuites');
			runSuitesStub.onCall(0).resolves(false);
			runSuitesStub.onCall(1).resolves(true);
			runSuitesStub.onCall(2).resolves(true);

			const ok = await runner._runWithSuiteRetries();

			expect(ok).to.equal(true);
			expect(initRuntimeStub.callCount).to.equal(1);
			expect(shutdownRuntimeStub.callCount).to.equal(1);
			expect(runSuitesStub.getCalls().map(call => call.args[0][0].title)).to.deep.equal(['suite_01', 'suite_01', 'suite_02']);
		});
	});
});
