const sinon = require('sinon');
const proxyquire = require('proxyquire');
const { patchFs } = require('fs-monkey');
const { vol } = require('memfs');

const { expect, config, log } = require('./test');
const { Runner } = proxyquire('./runner', { './config': { config } });

describe('Runner', () => {
	let runner = null;
	let unpatchFs = null;

	before(() => {
		unpatchFs = patchFs(vol);
	});

	after(() => {
		unpatchFs();
	});

	beforeEach(() => {
		vol.fromJSON({
			'/test': {},
			'/tmp': {}
		});
		config.set({
			testDir: '/test',
			platforms: ['boron']
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
				'/test/test.spec.js':
`test('test_01', () => {
});

test('test_02', () => {
});
` });
			await runner.init();
		});
	});
});
