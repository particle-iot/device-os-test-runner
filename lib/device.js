'use strict';
const { platformForId, isKnownPlatformId } = require('./platform');
const { delay } = require('./util');
const { config } = require('./config');
const { RunnerError, InternalError } = require('./error');

const particleUsb = require('particle-usb');
const usb = require('usb').usb;

const EventEmitter = require('events');
const fs = require('fs');

const { cycleUSBwithPortPath } = require('./hub-cycle');

const DEVICE_OPEN_TIMEOUT = 90000;
const DEVICE_OPEN_RETRIES = 3;
const DEVICE_OPEN_MIN_RETRY_DELAY = 300;
const DEVICE_OPEN_MAX_RETRY_DELAY = 1000;
const DEVICE_DELAY_AFTER_ATTACH = 1000;
const DEVICE_RESET_TIMEOUT = 10000;
const DEVICE_FLASH_TIMEOUT = 10 * 60 * 1000;
const DEFAULT_TEST_TIMEOUT = 10 * 60 * 1000; // Up to our cellular registration timeout
const DEFAULT_REQUEST_TIMEOUT = 60000;
const TEST_REQUEST_TYPE = 10; // ctrl_request_type::CTRL_REQUEST_APP_CUSTOM
const RESULT_NOT_FOUND = -170; // system error: NOT_FOUND
const RESULT_NOT_SUPPORTED = -120; // system error: NOT_SUPPORTED
const PANIC_REQUEST_TIMEOUT = 10000;

// Result codes reported by the unit test library
const RequestResult = {
	STATUS_PASSED: 1,
	STATUS_FAILED: 2,
	STATUS_SKIPPED: 3,
	STATUS_RUNNING: 4,
	STATUS_WAITING: 5,
	RESET_PENDING: 6,
	// NOTE: We should probably have some common shared system_error.h definitions
	// between JS and Device OS side in some form
	NOT_SUPPORTED: -120
};

const TestResult = {
	PASSED: Symbol('passed'),
	FAILED: Symbol('failed'),
	SKIPPED: Symbol('skipped')
};

const MailboxTypes = {
	RESET_PENDING: 1,
	DATA: 2,
	SAFE_MODE_PENDING: 3,
	PANIC_PENDING: 4
};

function formatPanicInfo(info) {
	let s = `panic: code=${info.code} pc=0x${(info.pc >>> 0).toString(16)} lr=0x${(info.lr >>> 0).toString(16)}` +
		` extra=0x${(info.extraCode >>> 0).toString(16)}`;
	if (info.text) {
		s += ` text="${info.text}"`;
	}
	if (info.registers && info.registers.length) {
		s += ` registers=[${info.registers.map(r => '0x' + (r >>> 0).toString(16)).join(', ')}]`;
	}
	return s;
}

// Structured panic info for test reports: addresses as hex strings for direct use with addr2line/gdb
function panicInfoReport(info) {
	return {
		code: info.code,
		pc: `0x${(info.pc >>> 0).toString(16)}`,
		lr: `0x${(info.lr >>> 0).toString(16)}`,
		extraCode: `0x${(info.extraCode >>> 0).toString(16)}`,
		text: info.text,
		registers: (info.registers || []).map(r => `0x${(r >>> 0).toString(16)}`)
	};
}

const PollingPolicy = {
	DEFAULT: particleUsb.PollingPolicy.DEFAULT,
	RELAXED: (n) => Math.min(1000, (n + 1) * 250)
};

function usbDevicePortPath(dev) {
	return dev.busNumber.toString() + '-' + dev.portNumbers.join('.');
}

class Device extends EventEmitter {
	constructor({ id, name, platform, portPath, log }) {
		super();
		this._log = log; // Logger instance
		this._id = id; // Device ID
		this._name = name; // Device name
		this._platform = platform; // Device platform
		this._portPath = portPath; // USB port path
		this._usbDev = null; // USB device
		this._attached = false; // Whether the device is attached to the system
		this._willDetach = false; // Whether the device is expected to detach from the system
		this._opening = false; // Whether the device is being opened
		this._closing = false; // Whether the device is being closed
		this._needClose = false; // Whether the device needs to be closed
		this._lastAttach = 0; // Time when the device last attached to the system
		this._testAppBinFile = null; // File name of the test binary that is currently running on the device
		this._panicResolver = null; // PanicResolver used for panic info symbolication
		this._moduleHashes = null; // Module hashes fetched alongside the first panic info
	}

	async getTests() {
		const rep = await this._request({ c: 'l' }); // List tests
		return rep.data;
	}

	async readMailbox() {
		const rep = await this._request({ c: 'M' });
		if (rep && rep.data) {
			// `id` is an internal correlation token for the ACK mechanism,
			// don't surface it to listeners of the 'mailbox' event.
			const { id: _mboxId, ...emitted } = rep.data;
			this.emit('mailbox', emitted);
		}
		return rep.data;
	}

	async ackMailbox(id) {
		await this._request({ c: 'A', id });
	}

	async initSuite(param) {
		const req = { c: 'i' }; // Init suite
		switch (param.systemMode) {
			case 'default': req.m = 'd'; break;
			case 'automatic': req.m = 'a'; break;
			case 'semi-automatic': req.m = 's'; break;
			case 'manual': req.m = 'm'; break;
			case 'safe-mode': req.m = 'S'; break;
		}
		switch (param.systemThread) {
			case 'enabled': req.t = 1; break;
			case 'disabled': req.t = 0; break;
		}
		if (param.clearBackupMemory) {
			req.b = 1;
		}
		const network = param.network || config.get('network');
		if (network) {
			switch (network) {
				case 'wifi': req.n = 'w'; break;
				case 'ethernet': req.n = 'e'; break;
				case 'cellular': req.n = 'c'; break;
			}
		}
		await this._request(req);
	}

	async startTest(name) {
		await this._request({ c: 't', t: name }); // Start test
	}

	async waitTest({ timeout = DEFAULT_TEST_TIMEOUT } = {}) {
		const panicResolver = this._panicResolver;
		let testResult = undefined;
		let panicInfoText = null; // Formatted panic info if the device panicked during the test
		let panicInfoRaw = null; // Structured panic info of the same panic
		const mboxMessages = [];
		const timeoutAt = Date.now() + timeout;

		let expectingReset = false;
		let expectingSafeMode = false;
		let expectingPanic = false;

		for (;;) {
			const t1 = Date.now();
			const reqTimeout = timeoutAt - t1;
			// Do not pass a zero timeout to particle-usb as it won't set a timer for the request in this case
			if (reqTimeout <= 0) {
				throw new Error('Test timeout');
			}

			if (!expectingSafeMode && !expectingReset && !expectingPanic) {
				try {
					const mbox = await this.readMailbox();
					if (mbox) {
						this._log.debug('Mailbox message', mbox);
						// `id` is an internal correlation token for the ACK mechanism. strip it from what's
						// exposed to tests via mboxMessages so deep-equal assertions on shape don't break.
						// mbox.id is still used below for ackMailbox().
						const { id: _mboxId, ...mboxClean } = mbox;
						// Capture local state (mboxMessages, expectingReset, expectingSafeMode)
						// BEFORE awaiting ACK. If the ACK call throws, the device-side ACK handler has already run
						// and the device is proceeding and we need our local state to match. setWillDetach()/close()
						// are deferred until AFTER ACK so they don't break ACK's _open() path.
						let isResetMbox = false;
						let isSafeModeMbox = false;
						let isPanicMbox = false;
						if (mboxClean.t && mboxClean.t === MailboxTypes.RESET_PENDING) {
							this._log.info('Device test notified about expected reset');
							isResetMbox = true;
							expectingReset = true;
							mboxMessages.push(mboxClean);
						} else if (mboxClean.t && mboxClean.t === MailboxTypes.SAFE_MODE_PENDING) {
							this._log.info('Device test notified about expected safe mode');
							isSafeModeMbox = true;
							expectingSafeMode = true;
							expectingReset = true;
							mboxMessages.push(mboxClean);
						} else if (mboxClean.t && mboxClean.t === MailboxTypes.PANIC_PENDING) {
							this._log.info('Device test notified about expected panic');
							isPanicMbox = true;
							expectingPanic = true;
							mboxMessages.push(mboxClean);
						} else if (mboxClean.t) {
							mboxMessages.push(mboxClean);
						}
						if (typeof mbox.id === 'number') {
							try {
								await this.ackMailbox(mbox.id);
							} catch (_ackErr) {
								// Device-side ACK handler already ran (deferred completion w/ ACK_DELAY_MS)
								// ACK response can race with USB detach on sleep entry, consume.
							}
						}
						if (isResetMbox || isSafeModeMbox || isPanicMbox) {
							this.setWillDetach(true);
							await this.close();
						}
					}
				} catch (_err) {
					this._log.debug('Failed to receive mailbox message');
				}
			}

			let rep = null;
			try {
				rep = await this._request({ c: 's' }, { timeout: reqTimeout, pollingPolicy: PollingPolicy.RELAXED }); // Get status
			} catch (err) {
				if (err instanceof particleUsb.TimeoutError && Date.now() >= timeoutAt) {
					// "Request timeout" -> "Test timeout"
					throw new Error('Test timeout');
				} else if (Date.now() < timeoutAt &&
						((expectingSafeMode && err instanceof RunnerError && err.code === RequestResult.NOT_SUPPORTED) ||
						(err instanceof particleUsb.UsbError))) {
					// Transient USB error (e.g. Linux xhci_hcd phantom EPIPE): treat as "still running" so
					// the next loop iteration retries instead of escalating to a fixture recovery reset of
					// both devices. Previously this swallow only fired in safe-mode; broadening it to any
					// in-window UsbError is what lets the ACK retry land.
					rep = { result: RequestResult.STATUS_RUNNING };
					if (expectingSafeMode) {
						this.setWillDetach(true);
					}
				} else {
					// FIXME: we may sometimes get 'Timeout while opening the device' exception even though
					// the device should already be openable. Close and retry until test timeout.
					// Alternatively we may try resetting it as well, but that may cause issues for the tests
					// as an expected reset may be a sleep call instead.
					if ((expectingReset || expectingSafeMode || expectingPanic) && err.message.includes('Timeout while opening')) {
						await this.close();
						rep = { result: RequestResult.STATUS_RUNNING };
					} else {
						throw err;
					}
				}
			}
			const dt = Date.now() - t1;
			if (rep.result !== RequestResult.STATUS_RUNNING) {
				switch (rep.result) {
					case RequestResult.STATUS_PASSED: {
						testResult = TestResult.PASSED;
						break;
					}
					case RequestResult.STATUS_FAILED: {
						testResult = TestResult.FAILED;
						break;
					}
					case RequestResult.STATUS_SKIPPED: {
						testResult = TestResult.SKIPPED;
						break;
					}
					case RequestResult.STATUS_WAITING: {
						if (expectingPanic) {
							// The device notified about an upcoming panic and rebooted; the panic
							// record must be set. Verify and consume it so that the following tests
							// see a clean device, and report it the same way an unexpected panic is
							// reported, including symbolication
							const panicInfo = await this.fetchAndClearPanicInfo().catch(() => null);
							if (panicInfo) {
								testResult = TestResult.PASSED;
								panicInfoText = formatPanicInfo(panicInfo);
								panicInfoRaw = panicInfo;
								let decoded = null;
								if (this._panicResolver) {
									decoded = await this._panicResolver.symbolicatePanicInfo(panicInfoReport(panicInfo), this._moduleHashes).catch(err => {
										this._log.debug(`Failed to symbolicate panic info: ${err.message}`);
										return null;
									});
								}
								this._log.info(`Device panicked as expected: ${panicInfoText}`);
								if (decoded && (decoded.pcDecoded || decoded.lrDecoded)) {
									this._log.info(`pc: ${decoded.pcDecoded || '?'}`);
									this._log.info(`lr: ${decoded.lrDecoded || '?'}`);
									panicInfo.decoded = decoded;
								}
							} else {
								testResult = TestResult.FAILED;
								this._log.error('Device notified about an expected panic but no panic info is stored');
							}
							this.setWillDetach(false);
							break;
						}
						if (expectingReset || expectingSafeMode) {
							// The device has reset. If the reset was actually caused by a panic, the
							// retained panic record is set and the panic info requests can fetch it
							const panicInfo = await this.fetchAndClearPanicInfo().catch(() => null);
							if (panicInfo) {
								testResult = TestResult.FAILED;
								panicInfoText = formatPanicInfo(panicInfo);
								panicInfoRaw = panicInfo;
								this._log.error(`Device panicked instead of the expected reset: ${panicInfoText}`);
							} else {
								testResult = TestResult.PASSED;
							}
							this.setWillDetach(false);
							break;
						}
						/* falls through */
					}
					default: {
						// A WAITING status without a prior reset notification means the device rebooted
						// unexpectedly - fetch the panic info to see if it panicked
						if (rep.result === RequestResult.STATUS_WAITING) {
							const panicInfo = await this.fetchAndClearPanicInfo().catch(() => null);
							if (panicInfo) {
								panicInfoText = formatPanicInfo(panicInfo);
								this._log.error(`Device panicked: ${panicInfoText}`);
								const err = new Error(`Device rebooted unexpectedly due to a panic: ${panicInfoText}`);
								err.panicInfo = panicInfoReport(panicInfo);
								throw err;
							}
						}
						throw new Error(`Unexpected test status: ${rep.result}`);
					}
				}
				break;
			}
			await delay(Math.min(1000, dt));
		}
		const finalPanic = await this.fetchAndClearPanicInfo().catch(() => null);
		if (finalPanic) {
			// A panic record is still set: the device rebooted at some point during the test and
			// none of the checkpoint checks observed it (e.g. the test re-ran after the reboot)
			this._log.error(`Device panicked during test: ${formatPanicInfo(finalPanic)}`);
			if (!panicInfoRaw) {
				panicInfoRaw = finalPanic;
				panicInfoText = formatPanicInfo(finalPanic);
			}
			if (testResult === TestResult.PASSED) {
				testResult = TestResult.FAILED;
			}
		}
		const result = { result: testResult };
		if (testResult === TestResult.FAILED) {
			try {
				const rep = await this._request({ c: 'L' }); // Get log
				result.log = rep.data.trim();
			} catch (_err) {
				// The device may be unreachable after a panic reset; the panic info is the diagnostic
				result.log = '';
			}
			if (panicInfoText) {
				result.log = `${panicInfoText}\n${result.log}`;
			}
		}
		if (panicInfoText) {
			result.panicInfoText = panicInfoText;
		}
		if (panicInfoRaw) {
			result.panicInfo = panicInfoReport(panicInfoRaw);
			if (panicResolver) {
				try {
					result.panicInfo = await panicResolver.symbolicatePanicInfo(result.panicInfo, this._moduleHashes);
				} catch (err) {
					this._log.debug(`Failed to symbolicate panic info: ${err.message}`);
				}
			}
		}
		// Consume all mailbox messages
		for (;;) {
			try {
				const mbox = await this.readMailbox();
				if (mbox && mbox.t) {
					// Strip the internal correlation `id` from the test-visible message (see comment in main loop above)
					const { id: _mboxId, ...mboxClean } = mbox;
					mboxMessages.push(mboxClean);
					// ACK so the entry is popped from the device-side queue and the kernel-bug workaround (OUT
					// between control INs) stays engaged on the next read. Same swallow semantics as the main-loop ACK.
					if (typeof mbox.id === 'number') {
						try {
							await this.ackMailbox(mbox.id);
						} catch (_ackErr) {
							// ACK response can race with device detach/reset at end of test, consume.
						}
					}
				} else {
					break;
				}
			} catch (_err) {
				break;
			}
		}
		result.mailBox = mboxMessages;
		return result;
	}

	async flash(binFile) {
		const bin = fs.readFileSync(binFile);
		await this._open();
		await this._usbDev.disconnectFromCloud({ force: true });
		this.setWillDetach(true);
		try {
			await this._usbDev.updateFirmware(bin, { timeout: DEVICE_FLASH_TIMEOUT });
			this.emit('reset');
		} catch (err) {
			this.setWillDetach(false);
			throw err;
		}
		// The flashed application changed: the module hashes fetched earlier describe the
		// previous firmware and must not be used to match ELFs for panic symbolication
		this._moduleHashes = null;
		await this._close();
	}

	async reset() {
		await this._open();
		try {
			this.setWillDetach(true);
			await this._usbDev.reset({ timeout: DEVICE_RESET_TIMEOUT });
		} catch (err) {
			if (err instanceof particleUsb.UsbError) {
				// The device has either reset or failed to receive the request, we can't know for sure
				throw err;
			}
			try {
				await this._usbDev.reset({ force: true });
			} catch (_err) {
				// Forced reset always fails at the host side, so ignore the second error
			}
		} finally {
			await this._close();
			this.emit('reset');
		}
	}

	async close() {
		await this._close();
	}

	setAttached(attached) {
		if (this._attached !== attached) {
			if (attached) {
				this._lastAttach = Date.now();
			} else {
				this.setWillDetach(false);
				if (this._usbDev && this._usbDev.isOpen) {
					this._needClose = true;
				}
			}
			this._attached = attached;
			this.emit('_attached', attached);
		}
	}

	setWillDetach(detach) {
		this._willDetach = detach;
	}

	setTestAppBinFile(file) {
		this._testAppBinFile = file;
	}

	setPanicResolver(resolver) {
		this._panicResolver = resolver;
	}

	resetTestAppBinFile() {
		this._testAppBinFile = null;
	}

	async getUsbDevice() {
		await this._open();
		return this._usbDev;
	}

	async getPanicInfo() {
		await this._open();
		const usbDev = this._usbDev;
		// Returns null if no panic data is available. The request is only supported by devices
		// running firmware built with the diagnostics control requests (Device OS 6.x+)
		let info = null;
		try {
			const rep = await usbDev.sendProtobufRequest('GetLastPanicInfoRequest', null, { timeout: PANIC_REQUEST_TIMEOUT });
			info = {
				code: rep.code,
				pc: rep.pc,
				lr: rep.lr,
				extraCode: rep.extra_code || 0,
				text: rep.text || '',
				registers: Array.from(rep.registers || [])
			};
		} catch (err) {
			// Duck-type on the request result: NOT_FOUND - no panic data is stored,
			// NOT_SUPPORTED - the firmware is older than the panic info requests
			if (err.result === RESULT_NOT_FOUND || err.result === RESULT_NOT_SUPPORTED) {
				if (err.result === RESULT_NOT_SUPPORTED) {
					this._log.debug('Device firmware does not support panic info requests');
				}
				return null;
			}
			throw err;
		}
		return info;
	}

	// Returns the SHA-256 hashes of the modules currently flashed to the device, by
	// FirmwareModuleType (see proto_defs/cloud/describe.proto). Used to pick the matching
	// ELF files for symbolication of panic info
	async getModuleHashes() {
		await this._open();
		let rep;
		try {
			rep = await this._usbDev.sendProtobufRequest('GetModuleInfoRequest', null, { timeout: PANIC_REQUEST_TIMEOUT });
		} catch (err) {
			// The device may be running firmware without support for this request
			if (err.result === RESULT_NOT_SUPPORTED) {
				this._log.debug('Device firmware does not support module info requests');
				return null;
			}
			throw err;
		}
		const hashes = {};
		for (const m of (rep.modules || [])) {
			if (m.hash && m.hash.length) {
				hashes[m.type] = Buffer.from(m.hash);
			}
		}
		return hashes;
	}

	async clearPanicInfo() {
		await this._open();
		try {
			await this._usbDev.sendProtobufRequest('ClearLastPanicInfoRequest', null, { timeout: PANIC_REQUEST_TIMEOUT });
		} catch (err) {
			this._log.debug(`Failed to clear panic info: ${err.message}`);
		}
	}

	// Fetches the last panic info and clears the stored record, so that a record observed later
	// is known to originate from a later test. Returns null if no panic data is stored or the
	// device firmware doesn't support the requests.
	// The panicked device has rebooted by the time the panic info is readable, so the module
	// hashes used for symbolication can be fetched in the same window - but only once, when a
	// panic is actually observed
	async fetchAndClearPanicInfo() {
		const info = await this.getPanicInfo().catch(err => {
			this._log.debug(`Failed to fetch panic info: ${err.message}`);
			return null;
		});
		if (info) {
			if (!this._moduleHashes) {
				this._moduleHashes = await this.getModuleHashes().catch(err => {
					this._log.debug(`Failed to fetch module hashes: ${err.message}`);
					return null;
				});
			}
			await this.clearPanicInfo();
		}
		return info;
	}

	// Checks the device for a leftover panic record after a test and, when one is found,
	// symbolicates it and returns a failure error. Used for tests whose body runs on the
	// host (JavaScript tests interacting with the device directly), where the waitTest()
	// panic checkpoints don't apply: a panic during such a test only surfaces as a confusing
	// USB error, and the record would otherwise be attributed to the next test. A record
	// left over from before the suite started is consumed and discarded in init() instead.
	// Returns null if no panic was recorded
	async checkPanicAfterTest() {
		const info = await this.fetchAndClearPanicInfo();
		if (!info) {
			return null;
		}
		const formatted = formatPanicInfo(info);
		this._log.error(`Device panicked during test: ${formatted}`);
		let decoded = null;
		if (this._panicResolver) {
			decoded = await this._panicResolver.symbolicatePanicInfo(panicInfoReport(info), this._moduleHashes).catch((err) => {
				this._log.debug(`Failed to symbolicate panic info: ${err.message}`);
				return null;
			});
		}
		const err = new Error(`Device panicked during test: ${formatted}`);
		err.panicInfo = decoded || panicInfoReport(info);
		return err;
	}

	get id() {
		return this._id;
	}

	get name() {
		return this._name;
	}

	get displayName() {
		if (this._name) {
			return `${this._id} (${this._name})`;
		}
		return this._id;
	}

	get platform() {
		return this._platform;
	}

	get portPath() {
		return this._portPath;
	}

	get testAppBinFile() {
		return this._testAppBinFile;
	}

	async _request(req, { timeout = DEFAULT_REQUEST_TIMEOUT, pollingPolicy = PollingPolicy.DEFAULT } = {}) {
		await this._open();
		let close = false;
		try {
			const rep = await this._usbDev.sendControlRequest(TEST_REQUEST_TYPE, JSON.stringify(req),
				{ timeout, pollingPolicy });
			if (rep.data) {
				rep.data = JSON.parse(rep.data);
			}
			if (rep.result < 0) {
				throw new RunnerError(`Runner command failed, code: ${rep.result}`, rep.result);
			}
			if (rep.result === RequestResult.RESET_PENDING) {
				this.setWillDetach(true);
				close = true;
			}
			return rep;
		} catch (err) {
			if (!(err instanceof RunnerError) && !(err instanceof particleUsb.UsbError)) {
				close = true;
			}
			throw err;
		} finally {
			if (close) {
				await this._close();
			}
		}
	}

	async _open() {
		let timeoutAt = Date.now() + DEVICE_OPEN_TIMEOUT;
		const canOpen = () => (!this._opening && !this._closing);
		while (!canOpen()) {
			const p = new Promise((resolve, reject) => {
				let timer = null;
				const onChange = () => {
					if (canOpen()) {
						clearTimeout(timer);
						this.off('_opening', onChange);
						this.off('_closing', onChange);
						resolve();
					}
				};
				const onTimeout = () => {
					this.off('_opening', onChange);
					this.off('_closing', onChange);
					reject(new Error('Timeout while opening the device'));
				};
				this.on('_opening', onChange);
				this.on('_closing', onChange);
				timer = setTimeout(onTimeout, Math.max(0, timeoutAt - Date.now()));
			});
			await p;
		}
		this._opening = true;
		this.emit('_opening', true);
		try {
			let retries = DEVICE_OPEN_RETRIES;
			const isAttached = () => (this._attached && !this._willDetach);
			while (!isAttached()) {
				const p = new Promise((resolve, reject) => {
					let timer = null;
					const onChange = () => {
						if (isAttached()) {
							clearTimeout(timer);
							this.off('_attached', onChange);
							resolve();
						}
					};
					const onTimeout = () => {
						this.off('_attached', onChange);
						reject(new Error('Timeout while opening the device'));
					};
					this.on('_attached', onChange);
					timer = setTimeout(onTimeout, Math.max(0, timeoutAt - Date.now()));
				});
				try {
					await p;
				} catch (err) {
					if (this._attached) {
						// Next time, do not wait for the device to reattach
						this.setWillDetach(false);
					}
					// Try once more
					// XXX: There seems to be some kind of a problem at least on HIL that prevents
					// devices from being recognized as re-attached unless we close. Once done,
					// they immediately get picked up as attached by node-usb.
					if (this._usbDev) {
						await this._usbDev.close({ processPendingRequests: false });
						try {
							if (await cycleUSBwithPortPath(this._portPath, { delaySec: 2 })) {
								this._log.info('[1] Cycled USB hub.port device is attached to');
							} else {
								this._log.warn('[1] Hub-cycle disabled, cannot recover from:', err.message);
							}
						} catch (cycleErr) {
							this._log.error('[1] Cycle USB failed:', cycleErr.message);
						}
						this._usbDev = null;
					}
					if (retries--) {
						timeoutAt = Date.now() + DEVICE_OPEN_TIMEOUT;
					} else {
						throw err;
					}
				}
			}
			if (this._needClose) {
				this._needClose = false;
				if (this._usbDev) {
					await this._usbDev.close({ processPendingRequests: false });
				}
			}
			if (!this._usbDev || !this._usbDev.isOpen) {
				const dt = this._lastAttach ? (Date.now() - this._lastAttach) : 0;
				if (dt < DEVICE_DELAY_AFTER_ATTACH) {
					await delay(DEVICE_DELAY_AFTER_ATTACH - dt);
				}
				this._log.debug('Opening USB device');
				let retries = DEVICE_OPEN_RETRIES;
				for (;;) {
					if (Date.now() >= timeoutAt) {
						throw new Error('Timeout while opening the device');
					}
					let dev = null;
					try {
						const devs = await particleUsb.getDevices();
						dev = devs.find(dev => usbDevicePortPath(dev.usbDevice.internalObject) === this._portPath);
						if (!dev) {
							try {
								if (await cycleUSBwithPortPath(this._portPath, { delaySec: 2 })) {
									this._log.info('[2a] Cycled USB hub.port device is attached to');
								} else {
									this._log.warn('[2a] Hub-cycle disabled, device not found by portPath');
								}
							} catch (cycleErr) {
								this._log.error('[2a] Cycle USB failed:', cycleErr.message);
							}
							throw new Error('Device not found');
						}
						await dev.open();
						if (this._needClose) {
							this._needClose = false;
							try {
								if (await cycleUSBwithPortPath(this._portPath, { delaySec: 2 })) {
									this._log.info('[2b] Cycled USB hub.port device is attached to');
								} else {
									this._log.warn('[2b] Hub-cycle disabled, device required re-cycle after open');
								}
							} catch (cycleErr) {
								this._log.error('[2b] Cycle USB failed:', cycleErr.message);
							}
							throw new Error('Device not found');
						}
						this._usbDev = dev;
						break;
					} catch (err) {
						if (dev) {
							await dev.close({ processPendingRequests: false });
							try {
								if (await cycleUSBwithPortPath(this._portPath, { delaySec: 2 })) {
									this._log.info('[2c] Cycled USB hub.port device is attached to');
								} else {
									this._log.warn('[2c] Hub-cycle disabled, cannot recover from:', err.message);
								}
							} catch (cycleErr) {
								this._log.error('[2c] Cycle USB failed:', cycleErr.message);
							}
						}
						if (!retries) {
							throw err;
						}
						--retries;
						await delay(DEVICE_OPEN_MIN_RETRY_DELAY + Math.ceil(Math.random() * (DEVICE_OPEN_MAX_RETRY_DELAY -
								DEVICE_OPEN_MIN_RETRY_DELAY)));
					}
				}
			}
		} finally {
			this._opening = false;
			this.emit('_opening', false);
		}
	}

	async _close() {
		const canClose = () => (!this._opening && !this._closing);
		while (!canClose()) {
			const p = new Promise(resolve => {
				const onChange = () => {
					if (canClose()) {
						this.off('_opening', onChange);
						this.off('_closing', onChange);
						resolve();
					}
				};
				this.on('_opening', onChange);
				this.on('_closing', onChange);
			});
			await p;
		}
		this._closing = true;
		this.emit('_closing', true);
		try {
			if (this._usbDev) {
				await this._usbDev.close({ processPendingRequests: false });

				// DEBUG: Leaving this here in case we need it in the future.
				//        I tested leaving this in, and cycling ports every
				//        time they close, but would get some errors rarely
				//        such as "Unable to get serial number descriptor",
				//        which seemed like a result of the device reattaching
				//        just before the device serial was required.
				//
				//        If any stuck open/closed port should appear again,
				//        enabling this again might be a good test.
				//
				// await cycleUSBwithPortPath(this._portPath, { delaySec: 2 })
				// 	.then(() => this._log.info('[3] Cycled USB hub.port device is attached to'))
				// 	.catch(err => this._log.error('[3] Cycle USB failed:', err.message));
			}
		} finally {
			this._needClose = false;
			this._closing = false;
			this.emit('_closing', false);
		}
	}
}

/**
 * Device manager.
 */
class DeviceManager {
	constructor({ apiClient, log }) {
		this._log = log; // Logger instance
		this._apiClient = apiClient; // API client
		this._devicePool = null; // Devices without a fixture indexed by platform ID
		this._fixtures = null; // Devices indexed by fixture name and platform ID
		this._fixturesByDeviceId = null; // Fixture names indexed by device ID
		this._allDevices = null; // All detected devices
		this._onAttachFn = (dev) => { // Listener for node-usb 'attach' events
			this._setAttached(dev, true);
		};
		this._onDetachFn = (dev) => { // Listener for node-usb 'detach' events
			this._setAttached(dev, false);
		};
	}

	async init(enabledPlatforms) {
		this._log.verbose('Enumerating USB devices');
		const devs = await this._getLocalDevices();
		if (!devs.length) {
			throw new Error('No USB devices found');
		}
		this._log.verbose('Retrieving devices from the cloud');
		await this._fetchDeviceInfo(devs);
		// Initialize device index
		this._initDeviceIndex(devs, enabledPlatforms);
		for (const dev of this._allDevices) {
			dev.setAttached(true);
		}
		usb.on('attach', this._onAttachFn);
		usb.on('detach', this._onDetachFn);
	}

	async shutdown() {
		usb.off('attach', this._onAttachFn);
		usb.off('detach', this._onDetachFn);
		if (this._allDevices) {
			for (const dev of this._allDevices) {
				await dev.close();
			}
		}
	}

	getDevice({ platform, fixture }) {
		let platforms = null;
		if (fixture) {
			platforms = this._fixtures.get(fixture);
			if (!platforms) {
				throw new Error(`Unknown fixture: ${fixture}`);
			}
		} else {
			platforms = this._devicePool;
		}
		let id = platform.id;
		if (platform.mixed && Array.from(platforms.keys()).length === 1) {
			id = Array.from(platforms.keys())[0];
		}
		const devs = platforms.get(id);
		if (!devs || !devs.length) {
			throw new Error('No devices available for the target platform');
		}
		const dev = devs.shift();
		return dev;
	}

	releaseDevice(dev) {
		let platforms = null;
		const fixture = this._fixturesByDeviceId.get(dev.id);
		if (fixture) {
			platforms = this._fixtures.get(fixture);
			if (!platforms) {
				throw new InternalError();
			}
		} else {
			platforms = this._devicePool;
		}
		const devs = platforms.get(dev.platform.id);
		if (!devs) {
			throw new InternalError();
		}
		dev.resetTestAppBinFile();
		devs.push(dev); // Move the device to the back of the queue
	}

	_initDeviceIndex(devs, enabledPlatforms) {
		const devsById = devs.reduce((map, dev) => map.set(dev.id, dev), new Map());
		const devsByName = devs.reduce((map, dev) => dev.name ? map.set(dev.name, dev) : map, new Map());
		const getDevice = (idOrName) => {
			let dev = devsById.get(idOrName);
			if (!dev) {
				dev = devsByName.get(idOrName);
			}
			return dev;
		};
		// Get enabled devices
		const enabledDevIds = new Set();
		for (const idOrName of config.get('devices')) {
			const dev = getDevice(idOrName);
			if (!dev) {
				throw new Error(`Device not found: ${idOrName}`);
			}
			if (enabledPlatforms && !enabledPlatforms.has(dev.platform.id)) {
				this._log.debug(`Skipping device with a disabled platform: ${idOrName}`);
				continue;
			}
			enabledDevIds.add(dev.id);
		}
		// Load fixture settings
		this._fixtures = new Map();
		this._fixturesByDeviceId = new Map();
		this._allDevices = [];
		for (const fixture of config.get('fixtures')) {
			if (this._fixtures.has(fixture.name)) {
				throw new Error(`Duplicate fixture name: ${fixture.name}`);
			}
			const fixtureDevIds = new Set();
			for (const idOrName of fixture.devices) {
				const dev = getDevice(idOrName);
				if (!dev) {
					if (enabledDevIds.size) {
						this._log.debug(`Skipping disabled device: ${idOrName}`);
						continue;
					}
					throw new Error(`Device not found: ${idOrName}`);
				}
				if (this._fixturesByDeviceId.has(dev.id)) {
					throw new Error(`Device is already used in another fixture: ${idOrName}`);
				}
				if (fixtureDevIds.has(dev.id)) {
					continue;
				}
				let platforms = this._fixtures.get(fixture.name); // Fixture platforms
				if (!platforms) {
					platforms = new Map();
					this._fixtures.set(fixture.name, platforms);
				}
				let devs = platforms.get(dev.platform.id); // Fixture devices
				if (!devs) {
					devs = [];
					platforms.set(dev.platform.id, devs);
				}
				const d = new Device({ ...dev, log: this._log });
				devs.push(d);
				this._fixturesByDeviceId.set(dev.id, fixture.name);
				this._allDevices.push(d);
			}
		}
		// Initialize device pool
		this._devicePool = new Map();
		devs = devs.filter(dev => !this._fixturesByDeviceId.has(dev.id) && (!enabledDevIds.size || enabledDevIds.has(dev.id)));
		for (const dev of devs) {
			let platformDevs = this._devicePool.get(dev.platform.id);
			if (!platformDevs) {
				platformDevs = [];
				this._devicePool.set(dev.platform.id, platformDevs);
			}
			const d = new Device({ ...dev, log: this._log });
			platformDevs.push(d);
			this._allDevices.push(d);
		}
		if (this._devicePool.size) {
			this._log.verbose('Device pool:');
			this._devicePool.forEach(devs => {
				devs.forEach(dev => this._log.verbose(dev.displayName));
			});
		} else {
			this._log.verbose('Device pool is empty');
		}
		if (this._fixtures.size) {
			// TODO: Log fixture settings
		} else {
			this._log.verbose('No fixtures configured');
		}
	}

	async _fetchDeviceInfo(devs) {
		const cloudDevs = await this._apiClient.getDevices();
		const devNames = cloudDevs.reduce((map, dev) => dev.name ? map.set(dev.id, dev.name) : map, new Map());
		devs.forEach(dev => dev.name = devNames.get(dev.id));
		return devs;
	}

	async _getLocalDevices() {
		const devs = [];
		const particleDevs = await particleUsb.getDevices();
		for (const particleDev of particleDevs) {
			let id = null;
			const usbDev = particleDev.usbDevice.internalObject;
			// Make a few attempts to query the device's ID in case it's being used in another process
			let lastError = null;
			let retries = DEVICE_OPEN_RETRIES;
			for (;;) {
				try {
					try {
						usbDev.open();
					} catch (err) {
						throw new Error(`Unable to open device: ${err.message}`);
					}
					const p = new Promise((resolve, reject) => {
						usbDev.getStringDescriptor(usbDev.deviceDescriptor.iSerialNumber, (err, serial) => {
							if (err) {
								return reject(new Error(`Unable to get device serial number: ${err.message}`));
							}
							resolve(serial.replace(/[^\x20-\x7e]/g, '').toLowerCase());
						});
					});
					id = await p;
					lastError = null;
					break;
				} catch (err) {
					lastError = err;
					if (!retries) {
						break;
					}
					--retries;
				} finally {
					try {
						usbDev.close();
					} catch (_err) {
						// Ignore error
					}
				}
				await delay(DEVICE_OPEN_MIN_RETRY_DELAY + Math.ceil(Math.random() * (DEVICE_OPEN_MAX_RETRY_DELAY -
						DEVICE_OPEN_MIN_RETRY_DELAY)));
			}
			if (lastError) {
				this._log.debug(lastError.message);
				continue;
			}
			const platformId = particleDev.platformId;
			if (!isKnownPlatformId(platformId)) {
				this._log.debug('Skipping device with an unsupported platform ID:', id);
				continue;
			}
			const platform = platformForId(platformId);
			const portPath = usbDevicePortPath(usbDev);
			devs.push({ id, platform, portPath });
		}
		return devs;
	}

	_setAttached(usbDev, attached) {
		const portPath = usbDevicePortPath(usbDev);
		const dev = this._allDevices.find(dev => dev.portPath === portPath);
		if (dev) {
			dev.setAttached(attached);
		}
	}

	getPlatformsForFixtures(fixtures) {
		const platforms = [];
		for (const f of fixtures) {
			const fixture = this._fixtures.get(f.name);
			if (fixture) {
				platforms.push(... fixture.keys());
			}
		}
		return Array.from(new Set(platforms));
	}
}

module.exports = {
	TestResult,
	Device,
	DeviceManager,
	formatPanicInfo,
	panicInfoReport
};
