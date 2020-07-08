const { platformForId, isKnownPlatformId, PLATFORMS } = require('./platform');
const { delay } = require('./util');
const { config } = require('./config');
const { RunnerError, InternalError } = require('./error');

const particleUsb = require('particle-usb');
const usb = require('usb');

const EventEmitter = require('events');
const fs = require('fs');

const DEVICE_OPEN_TIMEOUT = 30000;
const DEVICE_OPEN_RETRIES = 2;
const DEVICE_OPEN_MIN_RETRY_DELAY = 300;
const DEVICE_OPEN_MAX_RETRY_DELAY = 1000;
const DEVICE_DELAY_AFTER_ATTACH = 1000;
const DEVICE_RESET_TIMEOUT = 10000;
const DEVICE_FLASH_TIMEOUT = 90000;
const DEFAULT_TEST_TIMEOUT = 10 * 60 * 1000; // Up to our cellular registration timeout
const DEFAULT_REQUEST_TIMEOUT = 60000;
const REQUEST_POLL_INTERVAL = 500;
const TEST_REQUEST_TYPE = 10; // ctrl_request_type::CTRL_REQUEST_APP_CUSTOM

// Result codes reported by the unit test library
const RequestResult = {
	STATUS_PASSED: 1,
	STATUS_FAILED: 2,
	STATUS_SKIPPED: 3,
	STATUS_RUNNING: 4,
	STATUS_WAITING: 5,
	RESET_PENDING: 6
};

const TestResult = {
	PASSED: Symbol('passed'),
	FAILED: Symbol('failed'),
	SKIPPED: Symbol('skipped')
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
	}

	async getTests() {
		const rep = await this._request({ c: 'l' }); // List tests
		return rep.data;
	}

	async startTest(name, param) {
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
		await this._request(req);
		await this._request({ c: 't', t: name }); // Start test
	}

	async waitTest({ timeout = DEFAULT_TEST_TIMEOUT } = {}) {
		let testResult = undefined;
		const timeoutAt = Date.now() + timeout;
		for (;;) {
			const reqTimeout = timeoutAt - Date.now();
			// Do not pass a zero timeout to particle-usb as it won't set a timer for the request in this case
			if (reqTimeout <= 0) {
				throw new Error('Test timeout');
			}
			let rep = null;
			try {
				rep = await this._request({ c: 's' }, { timeout: reqTimeout }); // Get status
			} catch (err) {
				if (err instanceof particleUsb.TimeoutError && Date.now() >= timeoutAt) {
					// "Request timeout" -> "Test timeout"
					throw new Error('Test timeout');
				}
				throw err;
			}
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
					default: {
						throw new Error(`Unexpected test status: ${rep.result}`);
					}
				}
				break;
			}
			await delay(REQUEST_POLL_INTERVAL);
		}
		const result = { result: testResult };
		if (testResult === TestResult.FAILED) {
			const rep = await this._request({ c: 'L' }); // Get log
			result.log = rep.data.trim();
		}
		return result;
	}

	async flash(binFile) {
		const bin = fs.readFileSync(binFile);
		await this._open();
		await this._usbDev.disconnectFromCloud({ force: true });
		this._willDetach = true;
		try {
			await this._usbDev.updateFirmware(bin, { timeout: DEVICE_FLASH_TIMEOUT });
		} catch (err) {
			this._willDetach = false;
			throw err;
		}
		await this._close();
	}

	async reset() {
		await this._open();
		try {
			this._willDetach = true;
			await this._usbDev.reset({ timeout: DEVICE_RESET_TIMEOUT });
		} catch (err) {
			if (err instanceof particleUsb.UsbError) {
				// The device has either reset or failed to receive the request, we can't know for sure
				throw err;
			}
			try {
				await this._usbDev.reset({ force: true });
			} catch (err) {
				// Forced reset always fails at the host side, so ignore the second error
			}
		} finally {
			await this._close();
		}
	}

	async close() {
		await this._close();
	}

	setAttached(attached) {
		if (this._attached != attached) {
			if (attached) {
				this._lastAttach = Date.now();
			} else {
				this._willDetach = false;
				if (this._usbDev && this._usbDev.isOpen) {
					this._needClose = true;
				}
			}
			this._attached = attached;
			this.emit('_attached', attached);
		}
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

	async _request(req, { timeout = DEFAULT_REQUEST_TIMEOUT } = {}) {
		await this._open();
		let close = false;
		try {
			const rep = await this._usbDev.sendControlRequest(TEST_REQUEST_TYPE, JSON.stringify(req),
					{ timeout, pollingPolicy: REQUEST_POLL_INTERVAL });
			if (rep.data) {
				rep.data = JSON.parse(rep.data);
			}
			if (rep.result < 0) {
				throw new RunnerError(`Runner command failed, code: ${rep.result}`);
			}
			if (rep.result === RequestResult.RESET_PENDING) {
				this._willDetach = true;
				close = true;
			}
			return rep;
		} catch (err) {
			if (!(err instanceof RunnerError)) {
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
		const timeoutAt = Date.now() + DEVICE_OPEN_TIMEOUT;
		const canOpen = () => (!this._opening && !this._closing);
		while (!canOpen()) {
			const p = new Promise((resolve, reject) => {
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
				const timer = setTimeout(onTimeout, Math.max(0, timeoutAt - Date.now()));
			});
			await p;
		}
		this._opening = true;
		this.emit('_opening', true);
		try {
			const isAttached = () => (this._attached && !this._willDetach);
			while (!isAttached()) {
				const p = new Promise((resolve, reject) => {
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
					const timer = setTimeout(onTimeout, Math.max(0, timeoutAt - Date.now()));
				});
				try {
					await p;
				} catch (err) {
					if (this._attached) {
						// Next time, do not wait for the device to reattach
						this._willDetach = false;
					}
					throw err;
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
							throw new Error('Device not found');
						}
						await dev.open();
						if (this._needClose) {
							this._needClose = false;
							throw new Error('Device not found');
						}
						this._usbDev = dev;
						break;
					} catch (err) {
						if (dev) {
							await dev.close({ processPendingRequests: false });
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
			const p = new Promise((resolve, reject) => {
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
		for (let dev of this._allDevices) {
			dev.setAttached(true);
		}
		usb.on('attach', this._onAttachFn);
		usb.on('detach', this._onDetachFn);
	}

	async shutdown() {
		usb.off('attach', this._onAttachFn);
		usb.off('detach', this._onDetachFn);
		if (this._allDevices) {
			for (let dev of this._allDevices) {
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
		const devs = platforms.get(platform.id);
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
		for (let idOrName of config.get('devices')) {
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
		for (let fixture of config.get('fixtures')) {
			if (this._fixtures.has(fixture.name)) {
				throw new Error(`Duplicate fixture name: ${fixture.name}`);
			}
			const fixtureDevIds = new Set();
			for (let idOrName of fixture.devices) {
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
		for (let dev of devs) {
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
			this._devicePool.forEach((devs, platformId) => {
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
		for (let particleDev of particleDevs) {
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
					} catch (err) {
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
}

module.exports = {
	TestResult,
	Device,
	DeviceManager
};
