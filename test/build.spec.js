const { expect, log, fixturePath } = require('./test');
const { Builder } = require('../lib/build');

const sinon = require('sinon');

async function initBuilder(opts) {
	const builder = new Builder({ ...opts, log });
	await builder.init();
	return builder;
}

describe('Builder', () => {
	let builder = null;

	beforeEach(async () => {
		builder = await initBuilder({
			testDir: fixturePath(),
			deviceOsDir: '/path/to/device-os',
			tempDir: '/path/to/tmp'
		});
	});

	afterEach(async () => {
		sinon.restore();
		await builder.shutdown();
	});

	describe('findApps()', () => {
		it('finds application directories', async () => {
			const dirs = builder.findApps('.'); // Relative to the test directory
			expect(dirs).to.deep.equal(['suite_01', 'suite_02']);
		});
	});
});
