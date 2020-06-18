import { platformForId, isKnownPlatformId, PLATFORMS } from './platform';
import { delay } from './util';
import { config } from './config';
import { RunnerError, InternalError } from './error';

import * as usb from 'particle-usb';

import * as fs from 'fs';

const DEVICE_OPEN_TIMEOUT = 30000;
// Up to our cellular registration timeout
const DEFAULT_TEST_TIMEOUT = 10 * 60 * 1000;
const REQUEST_TYPE = 10; // ctrl_request_type::CTRL_REQUEST_APP_CUSTOM

// Result codes reported by the unit test library
const RequestResult = {
	STATUS_PASSED: 1,
	STATUS_FAILED: 2,
	STATUS_SKIPPED: 3,
	STATUS_RUNNING: 4,
	STATUS_WAITING: 5,
	RESET_PENDING: 6
};

export class Device {
	constructor({ id, name, platform, log }) {
		this._log = log; // Logger instance
		this._id = id; // Device ID
		this._name = name; // Device name
		this._platform = platform; // Device platform
		this._usbDev = null; // USB device
	}

	async init() {
	}

	async shutdown() {
		await this._close();
	}

	async flash(binFile) {
		const bin = fs.readFileSync(binFile);
		await this._open();
		await this._usbDev.enterListeningMode();
		await delay(1000); // Just in case
		await this._usbDev.updateFirmware(bin);
		await this._close();
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

	async waitTest() {
		let ok = true;
		const timeoutAt = Date.now() + DEFAULT_TEST_TIMEOUT;
		do {
			const rep = await this._request({ c: 's' }); // Get status
			if (rep.result !== RequestResult.STATUS_RUNNING) {
				ok = (rep.result === RequestResult.STATUS_PASSED || rep.result === RequestResult.STATUS_SKIPPED);
				break;
			}
			await delay(250);
		} while (Date.now() < timeoutAt);
		if (!ok) {
			const rep = await this._request({ c: 'L' }); // Get log
			throw new RunnerError(rep.data);
		}
	}

	async reset() {
		await this._open();
		await this._usbDev.reset();
		await this._close();
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

	async _request(req) {
		await this._open();
		let close = false;
		try {
			const rep = await this._usbDev.sendControlRequest(REQUEST_TYPE, JSON.stringify(req));
			if (rep.data) {
				rep.data = JSON.parse(rep.data);
			}
			if (rep.result < 0) {
				throw new RunnerError(`Runner command failed, code: ${rep.result}`);
			}
			if (rep.result === RequestResult.RESET_PENDING) {
				close = true;
			}
			return rep;
		} catch (e) {
			if (!(e instanceof RunnerError)) {
				close = true;
			}
			throw e;
		} finally {
			if (close) {
				await this._close();
			}
		}
	}

	async _open() {
		if (!this._usbDev) {
			this._log.debug('Opening USB device');
			const timeoutAt = Date.now() + DEVICE_OPEN_TIMEOUT;
			do {
				try {
					// Open the device and ping it with an empty request
					this._usbDev = await usb.openDeviceById(this._id);
					await this._usbDev.sendControlRequest(REQUEST_TYPE);
					return;
				} catch (e) {
					await this._close();
					await delay(250);
				}
			} while (Date.now() < timeoutAt);
			throw new Error('Unable to open USB device');
		}
	}

	async _close() {
		if (this._usbDev) {
			await this._usbDev.close({ processPendingRequests: false });
			this._usbDev = null;
		}
	}
}

/**
 * Device manager.
 */
export class DeviceManager {
	constructor({ apiClient, log }) {
		this._log = log; // Logger instance
		this._apiClient = apiClient; // API client
		this._devices = null; // Devices without a fixture indexed by platform ID
		this._fixtures = null; // Devices indexed by fixture name and platform ID
		this._fixturesByDeviceId = null; // Fixture names indexed by device ID
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
	}

	async shutdown() {
	}

	getDevice({ platform, fixture }) {
		let platforms = null;
		if (fixture) {
			platforms = this._fixtures.get(fixture);
			if (!platforms) {
				throw new Error(`Unknown fixture: ${fixture}`);
			}
		} else {
			platforms = this._devices;
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
			platforms = this._devices;
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
				devs.push(new Device({ ...dev, log: this._log }));
				this._fixturesByDeviceId.set(dev.id, fixture.name);
			}
		}
		// Initialize device pool
		this._devices = new Map();
		devs = devs.filter(dev => !this._fixturesByDeviceId.has(dev.id) && (!enabledDevIds.size || enabledDevIds.has(dev.id)));
		for (let dev of devs) {
			let platformDevs = this._devices.get(dev.platform.id);
			if (!platformDevs) {
				platformDevs = [];
				this._devices.set(dev.platform.id, platformDevs);
			}
			platformDevs.push(new Device({ ...dev, log: this._log }));
		}
		if (this._devices.size) {
			this._log.verbose('Device pool:');
			this._devices.forEach((devs, platformId) => {
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
		const usbDevs = await usb.getDevices();
		for (let usbDev of usbDevs) {
			await usbDev.open();
			const id = usbDev.id;
			const platformId = usbDev.platformId;
			await usbDev.close();
			if (!isKnownPlatformId(platformId)) {
				this._log.debug(`Skipping device with an unsupported platform ID: ${id}`);
				continue;
			}
			const platform = platformForId(platformId);
			devs.push({ id, platform });
		}
		return devs;
	}
}
