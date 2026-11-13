'use strict';
const { expect, sinon } = require('../test');
const proxyquire = require('proxyquire');
const { Device, formatPanicInfo, panicInfoReport } = require('./device');
const tmp = require('tmp');
describe('Device', () => {
	const fakeDeviceID = 123;
	const fakeLog = {
		error: () => {}, warn: () => {}, info: () => {}, verbose: () => {},
		debug: () => {}, silly: () => {}
	};
	let device;
	beforeEach(async () => {
		device = new Device({ id: fakeDeviceID, log: fakeLog });
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

	describe('panic info', () => {
		it('getPanicInfo() returns null when no panic data is stored', async () => {
			device._open = async () => {};
			device._usbDev = {
				sendProtobufRequest: async () => {
					throw makeRequestError(-170);
				}
			};
			expect(await device.getPanicInfo()).to.be.null;
		});
		it('getPanicInfo() returns null when the firmware does not support the request', async () => {
			device._open = async () => {};
			device._usbDev = {
				sendProtobufRequest: async () => {
					throw makeRequestError(-120);
				}
			};
			expect(await device.getPanicInfo()).to.be.null;
		});
		it('getPanicInfo() rethrows unrelated request errors', async () => {
			device._open = async () => {};
			device._usbDev = {
				sendProtobufRequest: async () => {
					throw makeRequestError(-130);
				}
			};
			try {
				await device.getPanicInfo();
				throw new Error('expected getPanicInfo() to reject');
			} catch (err) {
				expect(err.result).to.eql(-130);
			}
		});
		it('getPanicInfo() decodes the reply payload', async () => {
			device._open = async () => {};
			device._usbDev = {
				sendProtobufRequest: async () => ({
					code: 10,
					pc: 0x1234,
					lr: 0x5678,
					extra_code: 0x9a,
					text: 'assertion',
					registers: [1, 2, 3]
				})
			};
			const info = await device.getPanicInfo();
			expect(info.code).to.eql(10);
			expect(info.pc).to.eql(0x1234);
			expect(info.lr).to.eql(0x5678);
			expect(info.extraCode).to.eql(0x9a);
			expect(info.text).to.eql('assertion');
			expect(info.registers).to.eql([1, 2, 3]);
		});
		it('clearPanicInfo() swallows errors', async () => {
			device._open = async () => {};
			device._usbDev = {
				sendProtobufRequest: async () => {
					throw makeRequestError(-170);
				}
			};
			await device.clearPanicInfo();
		});
		it('fetchAndClearPanicInfo() fetches and clears on success', async () => {
			device._open = async () => {};
			const calls = [];
			device._usbDev = {
				sendProtobufRequest: async (name) => {
					calls.push(name);
					if (name === 'GetLastPanicInfoRequest') {
						return { code: 10, pc: 1, lr: 2, extra_code: 0, text: '', registers: [] };
					}
					if (name === 'GetModuleInfoRequest') {
						return { modules: [{ type: 4, hash: Buffer.alloc(32, 0xAA) }] };
					}
					return {};
				}
			};
			const info = await device.fetchAndClearPanicInfo();
			expect(info.code).to.eql(10);
			expect(calls).to.eql(['GetLastPanicInfoRequest', 'GetModuleInfoRequest', 'ClearLastPanicInfoRequest']);
			expect(device._moduleHashes[4].toString('hex')).to.eql(Buffer.alloc(32, 0xAA).toString('hex'));
		});
		it('fetchAndClearPanicInfo() tolerates a module info failure and still clears', async () => {
			device._open = async () => {};
			const calls = [];
			device._usbDev = {
				sendProtobufRequest: async (name) => {
					calls.push(name);
					if (name === 'GetLastPanicInfoRequest') {
						return { code: 10, pc: 1, lr: 2, extra_code: 0, text: '', registers: [] };
					}
					throw makeRequestError(-110); // module info request fails
				}
			};
			const info = await device.fetchAndClearPanicInfo();
			expect(info.code).to.eql(10);
			expect(calls).to.eql(['GetLastPanicInfoRequest', 'GetModuleInfoRequest', 'ClearLastPanicInfoRequest']);
			expect(device._moduleHashes).to.be.null;
		});
		it('fetchAndClearPanicInfo() returns null and does not clear when no data is stored', async () => {
			device._open = async () => {};
			const calls = [];
			device._usbDev = {
				sendProtobufRequest: async (name) => {
					calls.push(name);
					throw makeRequestError(-170);
				}
			};
			expect(await device.fetchAndClearPanicInfo()).to.be.null;
			expect(calls).to.eql(['GetLastPanicInfoRequest']);
		});
		it('flash() invalidates the cached module hashes', async () => {
			device._open = async () => {};
			device._close = async () => {};
			device._moduleHashes = { 4: Buffer.alloc(32, 0xAA) };
			device._usbDev = {
				disconnectFromCloud: async () => {},
				updateFirmware: async () => {},
				close: async () => {}
			};
			const tmpFile = tmp.fileSync();
			try {
				await device.flash(tmpFile.name);
			} finally {
				tmpFile.removeCallback();
			}
			expect(device._moduleHashes).to.be.null;
		});
	});

	it('formatPanicInfo() renders code, addresses, text and registers', () => {
		const s = formatPanicInfo({ code: 10, pc: 0x8100ab, lr: 0x80ff1234, extraCode: 0x0,
																														text: 'assert(x)', registers: [1, 2] });
		expect(s).to.eql('panic: code=10 pc=0x8100ab lr=0x80ff1234 extra=0x0 text="assert(x)" registers=[0x1, 0x2]');
	});
	it('formatPanicInfo() omits empty text and registers', () => {
		const s = formatPanicInfo({ code: 4, pc: 0, lr: 0, extraCode: 0, text: '', registers: [] });
		expect(s).to.eql('panic: code=4 pc=0x0 lr=0x0 extra=0x0');
	});
	it('panicInfoReport() returns structured info with hex string addresses', () => {
		const r = panicInfoReport({ code: 10, pc: 0x8100ab, lr: 0x80ff1234, extraCode: 0xdeadbeef,
																														text: 'assert(x)', registers: [0x20001234, 0x9] });
		expect(r.code).to.eql(10);
		expect(r.pc).to.eql('0x8100ab');
		expect(r.lr).to.eql('0x80ff1234');
		expect(r.extraCode).to.eql('0xdeadbeef');
		expect(r.text).to.eql('assert(x)');
		expect(r.registers).to.eql(['0x20001234', '0x9']);
	});
	it('panicInfoReport() tolerates missing registers', () => {
		const r = panicInfoReport({ code: 2, pc: 1, lr: 2, extraCode: 0, text: '' });
		expect(r.registers).to.eql([]);
	});
});

describe('Device OpenOCD recovery', () => {
	const fakeDeviceID = '0a10aced202194944a001c10';
	let resetWithOpenOcd;
	let log;
	let device;

	beforeEach(() => {
		resetWithOpenOcd = sinon.stub().resolves(true);
		const { Device } = proxyquire('./device', { './openocd': { resetWithOpenOcd } });
		log = {
			error: sinon.stub(), warn: sinon.stub(), info: sinon.stub(), verbose: sinon.stub(),
			debug: sinon.stub(), silly: sinon.stub()
		};
		device = new Device({ id: fakeDeviceID, log });
	});

	afterEach(() => {
		sinon.restore();
	});

	describe('_recoverWithOpenOcd()', () => {
		it('resets the device through resetWithOpenOcd() and logs it', async () => {
			expect(await device._recoverWithOpenOcd('1')).to.equal(true);
			expect(resetWithOpenOcd).to.have.been.calledOnceWith(fakeDeviceID, log);
			expect(log.info).to.have.been.calledWithMatch('[1] Reset device');
		});

		it('expects a detach when the device was attached', async () => {
			device.setAttached(true);
			await device._recoverWithOpenOcd('1');
			expect(device._willDetach).to.equal(true);
		});

		it('does not expect a detach when the device was already detached', async () => {
			await device._recoverWithOpenOcd('1');
			expect(device._willDetach).to.equal(false);
		});

		it('returns false and clears willDetach when the reset is skipped', async () => {
			resetWithOpenOcd.resolves(false);
			device.setAttached(true);
			expect(await device._recoverWithOpenOcd('2a')).to.equal(false);
			expect(device._willDetach).to.equal(false);
			expect(log.info).to.not.have.been.called;
		});

		it('rethrows and clears willDetach when the reset fails', async () => {
			resetWithOpenOcd.rejects(new Error('reset failed'));
			device.setAttached(true);
			await expect(device._recoverWithOpenOcd('2c')).to.be.rejectedWith('reset failed');
			expect(device._willDetach).to.equal(false);
		});
	});

	describe('_waitForReattach()', () => {
		it('resolves true right away when the device is attached', async () => {
			device.setAttached(true);
			expect(await device._waitForReattach(1000)).to.equal(true);
		});

		it('resolves true once the device detaches and re-attaches after a reset', async () => {
			device.setAttached(true);
			await device._recoverWithOpenOcd('2a');
			const p = device._waitForReattach(1000);
			device.setAttached(false);
			device.setAttached(true);
			expect(await p).to.equal(true);
			expect(device._willDetach).to.equal(false);
		});

		it('resolves true once a detached device attaches', async () => {
			const p = device._waitForReattach(1000);
			device.setAttached(true);
			expect(await p).to.equal(true);
		});

		it('resolves false and clears willDetach when the device never detaches', async () => {
			const clock = sinon.useFakeTimers();
			device.setAttached(true);
			await device._recoverWithOpenOcd('2a');
			const p = device._waitForReattach(20000);
			await clock.tickAsync(20000);
			expect(await p).to.equal(false);
			expect(device._willDetach).to.equal(false);
			expect(device.listenerCount('_attached')).to.equal(0);
		});

		it('resolves false when a detached device never attaches', async () => {
			const clock = sinon.useFakeTimers();
			const p = device._waitForReattach(20000);
			await clock.tickAsync(20000);
			expect(await p).to.equal(false);
			expect(device.listenerCount('_attached')).to.equal(0);
		});
	});
});

// particle-usb RequestError shape (see particle-usb/src/error.js): an Error with a `result` property
function makeRequestError(result) {
	const err = new Error(`Request failed with result ${result}`);
	err.result = result;
	return err;
}
