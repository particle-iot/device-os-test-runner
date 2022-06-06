const { expect } = require('chai');
const { Device } = require('./device');
describe('Device', () => {
	const fakeDeviceID = 123;
	let device;
	beforeEach(async () => {
		device = new Device({ id: fakeDeviceID });
	});

	afterEach(async () => {
		// sinon.restore();
	});

	describe('instantiation', () => {
		it('captures constructor args to instance properties', () => {
			expect(device._id).to.eql(fakeDeviceID);
		});
	});

	it('provides getTests()');
	it('provides initSuite()');
	it('provides startTest()');
	it('provides waitTest()');
	it('provides flash()');
	it('provides reset()');
	it('provides close()');
	it('provides setAttached()');
	it('provides setTestAppBinFile()');
	it('provides resetTestAppBinFile()');
});
