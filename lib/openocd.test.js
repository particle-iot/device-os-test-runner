'use strict';
const { expect, sinon } = require('../test');

const { OpenOcdFlashInterface } = require('@particle/device-os-flash-util/lib/openocd');
const { config } = require('./config');
const { resetWithOpenOcd } = require('./openocd');

describe('openocd', () => {
	const fakeDeviceId = '0a10aced202194944a001c10';
	const otherDeviceId = '0a10aced202194944a040a44';
	let log;
	let adapter1;
	let adapter2;
	let listDevices;

	// Like OpenOcdDevice, open() reads the ID of the device the adapter is wired to
	function fakeAdapter(serialNumber, wiredDeviceId) {
		const adapter = {
			serialNumber,
			id: undefined,
			open: sinon.stub().callsFake(async () => {
				adapter.id = wiredDeviceId;
			}),
			reset: sinon.stub().resolves(),
			close: sinon.stub().resolves()
		};
		return adapter;
	}

	beforeEach(() => {
		log = {
			error: sinon.stub(), warn: sinon.stub(), info: sinon.stub(), verbose: sinon.stub(),
			debug: sinon.stub(), silly: sinon.stub()
		};
		adapter1 = fakeAdapter('SERIAL1', fakeDeviceId);
		adapter2 = fakeAdapter('SERIAL2', otherDeviceId);
		sinon.stub(OpenOcdFlashInterface.prototype, 'init').resolves();
		sinon.stub(OpenOcdFlashInterface.prototype, 'shutdown').resolves();
		listDevices = sinon.stub(OpenOcdFlashInterface.prototype, 'listDevices').resolves([adapter1, adapter2]);
		config.set('openocdReset', true);
	});

	afterEach(() => {
		sinon.restore();
		config.reset('openocdReset');
		config.reset('openocdAdapterSerial');
		config.reset('openocdAdapterMap');
	});

	it('provides resetWithOpenOcd()', () => {
		expect(resetWithOpenOcd).to.be.a('function');
	});

	describe('resetWithOpenOcd', () => {
		it('returns false without touching adapters when disabled', async () => {
			config.set('openocdReset', false);
			expect(await resetWithOpenOcd(fakeDeviceId, log)).to.equal(false);
			expect(listDevices).to.not.have.been.called;
			expect(log.warn).to.have.been.calledOnce;
		});

		it('returns false when device ID is missing', async () => {
			expect(await resetWithOpenOcd(undefined, log)).to.equal(false);
			expect(listDevices).to.not.have.been.called;
			expect(log.warn).to.have.been.calledOnce;
		});

		it('resets through the adapter given by openocdAdapterSerial', async () => {
			config.set('openocdAdapterSerial', 'SERIAL2');
			expect(await resetWithOpenOcd(otherDeviceId, log)).to.equal(true);
			expect(adapter2.open).to.have.been.calledOnce;
			expect(adapter2.reset).to.have.been.calledOnce;
			expect(adapter2.close).to.have.been.calledOnce;
			expect(adapter1.open).to.not.have.been.called;
		});

		it('resets through the adapter mapped to the device', async () => {
			config.set('openocdAdapterMap', { [otherDeviceId]: 'SERIAL2' });
			expect(await resetWithOpenOcd(otherDeviceId, log)).to.equal(true);
			expect(adapter2.reset).to.have.been.calledOnce;
			expect(adapter1.open).to.not.have.been.called;
		});

		it('prefers openocdAdapterMap over openocdAdapterSerial', async () => {
			config.set('openocdAdapterSerial', 'SERIAL1');
			config.set('openocdAdapterMap', { [otherDeviceId]: 'SERIAL2' });
			expect(await resetWithOpenOcd(otherDeviceId, log)).to.equal(true);
			expect(adapter2.reset).to.have.been.calledOnce;
			expect(adapter1.reset).to.not.have.been.called;
		});

		it('falls back to openocdAdapterSerial when the device is not in the map', async () => {
			config.set('openocdAdapterSerial', 'SERIAL1');
			config.set('openocdAdapterMap', { [otherDeviceId]: 'SERIAL2' });
			expect(await resetWithOpenOcd(fakeDeviceId, log)).to.equal(true);
			expect(adapter1.reset).to.have.been.calledOnce;
			expect(adapter2.reset).to.not.have.been.called;
		});

		it('matches the device ID case-insensitively', async () => {
			config.set('openocdAdapterMap', { [otherDeviceId]: 'SERIAL2' });
			expect(await resetWithOpenOcd(otherDeviceId.toUpperCase(), log)).to.equal(true);
			expect(adapter2.reset).to.have.been.calledOnce;
		});

		describe('with a configured serial', () => {
			it('does not reset when the mapped adapter is wired to a different device', async () => {
				config.set('openocdAdapterMap', { [fakeDeviceId]: 'SERIAL2' }); // SERIAL2 is wired to otherDeviceId
				expect(await resetWithOpenOcd(fakeDeviceId, log)).to.equal(false);
				expect(adapter2.open).to.have.been.calledOnce;
				expect(adapter2.reset).to.not.have.been.called;
				expect(adapter2.close).to.have.been.calledOnce;
				expect(log.error).to.have.been.calledOnce;
				expect(log.error.firstCall.args[0]).to.include(otherDeviceId).and.to.include(fakeDeviceId);
			});

			it('does not reset when openocdAdapterSerial is wired to a different device', async () => {
				config.set('openocdAdapterSerial', 'SERIAL1'); // SERIAL1 is wired to fakeDeviceId
				expect(await resetWithOpenOcd(otherDeviceId, log)).to.equal(false);
				expect(adapter1.reset).to.not.have.been.called;
				expect(adapter1.close).to.have.been.calledOnce;
				expect(log.error).to.have.been.calledOnce;
			});

			it('does not touch other adapters when the configured adapter is wired to a different device', async () => {
				config.set('openocdAdapterSerial', 'SERIAL1');
				await resetWithOpenOcd(otherDeviceId, log);
				expect(adapter2.open).to.not.have.been.called;
				expect(adapter2.reset).to.not.have.been.called;
			});

			it('reads the device ID before resetting', async () => {
				config.set('openocdAdapterSerial', 'SERIAL1');
				await resetWithOpenOcd(fakeDeviceId, log);
				expect(adapter1.open).to.have.been.calledBefore(adapter1.reset);
			});

			it('rejects and closes the adapter when the device ID cannot be read', async () => {
				config.set('openocdAdapterSerial', 'SERIAL1');
				adapter1.open.rejects(new Error('Unable to read device ID'));
				await expect(resetWithOpenOcd(fakeDeviceId, log)).to.be.rejectedWith('Unable to read device ID');
				expect(adapter1.reset).to.not.have.been.called;
				expect(adapter1.close).to.have.been.calledOnce;
			});

			it('does not reset when the adapter has no target attached', async () => {
				const adapter = fakeAdapter('SERIAL3', undefined);
				listDevices.resolves([adapter]);
				config.set('openocdAdapterSerial', 'SERIAL3');
				expect(await resetWithOpenOcd(fakeDeviceId, log)).to.equal(false);
				expect(adapter.reset).to.not.have.been.called;
				expect(adapter.close).to.have.been.calledOnce;
			});
		});

		it('returns false when the configured serial is not attached', async () => {
			config.set('openocdAdapterSerial', 'MISSING');
			expect(await resetWithOpenOcd(fakeDeviceId, log)).to.equal(false);
			expect(adapter1.open).to.not.have.been.called;
			expect(adapter2.open).to.not.have.been.called;
			expect(log.error).to.have.been.calledOnce;
		});

		it('closes the adapter when reset() rejects', async () => {
			config.set('openocdAdapterSerial', 'SERIAL1');
			adapter1.reset.rejects(new Error('reset failed'));
			await expect(resetWithOpenOcd(fakeDeviceId, log)).to.be.rejectedWith('reset failed');
			expect(adapter1.close).to.have.been.calledOnce;
		});

		describe('without a configured serial', () => {
			it('searches adapters for the device and resets it', async () => {
				expect(await resetWithOpenOcd(otherDeviceId, log)).to.equal(true);
				expect(adapter1.open).to.have.been.calledOnce;
				expect(adapter1.reset).to.not.have.been.called;
				expect(adapter1.close).to.have.been.calledOnce;
				expect(adapter2.reset).to.have.been.calledOnce;
				expect(adapter2.close).to.have.been.calledOnce;
			});

			it('stops searching once the device is found', async () => {
				expect(await resetWithOpenOcd(fakeDeviceId, log)).to.equal(true);
				expect(adapter1.reset).to.have.been.calledOnce;
				expect(adapter2.open).to.not.have.been.called;
			});

			it('skips adapters that fail to open', async () => {
				adapter1.open.rejects(new Error('open failed'));
				expect(await resetWithOpenOcd(otherDeviceId, log)).to.equal(true);
				expect(adapter1.close).to.have.been.calledOnce;
				expect(adapter2.reset).to.have.been.calledOnce;
			});

			it('returns false when no adapter matches the device', async () => {
				expect(await resetWithOpenOcd('0a10aced2021000000000000', log)).to.equal(false);
				expect(adapter1.reset).to.not.have.been.called;
				expect(adapter2.reset).to.not.have.been.called;
				expect(adapter1.close).to.have.been.calledOnce;
				expect(adapter2.close).to.have.been.calledOnce;
				expect(log.error).to.have.been.calledOnce;
			});

			it('rejects and closes the adapter when reset() fails on the matching device', async () => {
				adapter2.reset.rejects(new Error('reset failed'));
				await expect(resetWithOpenOcd(otherDeviceId, log)).to.be.rejectedWith('reset failed');
				expect(adapter2.close).to.have.been.calledOnce;
			});
		});
	});

	// Runs against real hardware, skipped unless OPENOCD_HW_DEVICE_ID is set. Example:
	// OPENOCD_HW_DEVICE_ID=<device id> OPENOCD_HW_ADAPTER_SERIAL=<adapter serial> npx mocha lib/openocd.test.js
	(process.env.OPENOCD_HW_DEVICE_ID ? describe : describe.skip)('resetWithOpenOcd (hardware)', function () {
		this.timeout(60000);

		beforeEach(() => {
			// Undo the stubs from the outer beforeEach
			sinon.restore();
			if (process.env.OPENOCD_HW_ADAPTER_SERIAL) {
				config.set('openocdAdapterSerial', process.env.OPENOCD_HW_ADAPTER_SERIAL);
			}
		});

		it('resets the device', async () => {
			expect(await resetWithOpenOcd(process.env.OPENOCD_HW_DEVICE_ID, log)).to.equal(true);
		});
	});
});
