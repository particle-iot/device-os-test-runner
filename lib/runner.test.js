const sinon = require('sinon');
const proxyquire = require('proxyquire');
const { patchFs, patchRequire } = require('fs-monkey');
const { vol } = require('memfs');

const { expect, config, log } = require('./test');
const { Runner } = proxyquire('./runner', { './config': { config } });

let unpatchFs = null;

before(() => {
	patchRequire(vol); // Mocha uses require() to load spec files
	unpatchFs = patchFs(vol);
});

after(() => {
	unpatchFs();
});

describe('Runner', () => {
	let runner = null;

	beforeEach(() => {
		vol.fromJSON({
			'/test': {},
			'/tmp': {}
		});
		config.set({
			testDir: '/test',
			platforms: ['boron'],
			patterns: [],
			filters: []
		});
		runner = new Runner({ log });
	});

	afterEach(() => {
		sinon.restore();
		config.clear();
		vol.reset();
	});

	describe('init', () => {
		it('loads test files', async () => {
			vol.fromJSON({
				'/test/suite_01.spec.js': `suite('suite_01'); platform('boron'); test('test_01', () => {}); test('test_02', () => {});`,
				'/test/suite_02.spec.js': `suite('suite_02'); platform('boron'); test('test_01', () => {}); test('test_02', () => {});`
			});
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
