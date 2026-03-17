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
			runner._mocha = {
				suite: {
					suites: [
						{ title: 'suite_01', particle: { file: 'suite_01/suite_01.spec.js', exclude: false, suiteRetries: 1 } },
						{ title: 'suite_02', particle: { file: 'suite_02/suite_02.spec.js', exclude: false, suiteRetries: 0 } }
					]
				}
			};
			const initStub = sinon.stub(runner, 'init').resolves();
			const shutdownStub = sinon.stub(runner, 'shutdown').resolves();
			const selectStub = sinon.stub(runner, '_selectSuiteForRun');
			const runStub = sinon.stub(runner, '_run');
			runStub.onCall(0).resolves(false);
			runStub.onCall(1).resolves(true);
			runStub.onCall(2).resolves(true);

			const ok = await runner._runWithSuiteRetries();

			expect(ok).to.equal(true);
			expect(initStub.callCount).to.equal(3);
			expect(shutdownStub.callCount).to.equal(4);
			expect(selectStub.getCalls().map(call => call.args[0].title)).to.deep.equal(['suite_01', 'suite_01', 'suite_02']);
		});
	});
});
