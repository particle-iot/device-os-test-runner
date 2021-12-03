const { expect, config, log } = require('./test');
const proxyquire = require('proxyquire');
const { Runner } = proxyquire('../lib/runner', { './config': { config } });

const sinon = require('sinon');

const path = require('path');

describe('Runner', () => {
	let runner = null;

	beforeEach(() => {
		config.set({
			testDir: path.join(__dirname, 'fixtures'),
			platforms: ['boron'],
			patterns: [],
			filters: []
		});
		runner = new Runner({ log });
	});

	afterEach(() => {
		sinon.restore();
		config.clear();
	});

	describe('init', () => {
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
