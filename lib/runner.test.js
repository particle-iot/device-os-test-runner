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
			await runner.init();
			expect(runner.suites).to.containSubset([
				{
					title: 'suite_01',
					tests: [
						{ title: 'test_01' },
						{ title: 'test_02' }
					],
					particle: {
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
						platforms: [
							{ name: 'boron' }
						]
					}
				}
			]);
		});
	});
});
