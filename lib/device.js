import { platformForId, isKnownPlatformId, PLATFORMS } from './platform';
import { delay } from './util';
import { config } from './config';
import { InternalError } from './error';

import * as usb from 'particle-usb';

import * as fs from 'fs';

const DEVICE_OPEN_TIMEOUT = 5000;
const DEFAULT_TEST_TIMEOUT = 30000;
const REQUEST_TYPE = 10; // CTRL_REQUEST_APP_CUSTOM

export class Device {
	constructor({ id, name, platform, log }) {
		this._log = log; // Logger instance
		this._id = id; // Device ID
		this._name = name; // Device name
		this._platform = platform; // Device platform
	}

	async flash(binFile) {
		let usbDev = null;
		try {
			this._log.verbose(`Flashing firmware binary: ${binFile}`);
			const bin = fs.readFileSync(binFile);
			usbDev = await this._open();
			await usbDev.updateFirmware(bin);
		} finally {
			if (usbDev) {
				await usbDev.close();
			}
		}
	}

	async runTest(name) {
		let usbDev = null;
		try {
			usbDev = await this._open();
			name = name.replace(/\W+/g, '_').toLowerCase();
			this._log.verbose(`Running test on the device: ${name}`);
			await usbDev.sendControlRequest(REQUEST_TYPE, JSON.stringify({ cmd: 'include', name }));
			await usbDev.sendControlRequest(REQUEST_TYPE, JSON.stringify({ cmd: 'start' }));
			let ok = true;
			const timeout = Date.now() + DEFAULT_TEST_TIMEOUT;
			do {
				let r = await usbDev.sendControlRequest(REQUEST_TYPE, JSON.stringify({ cmd: 'status' }));
				r = JSON.parse(r.data);
				if (r.passed + r.failed + r.skipped === r.count) {
					if (r.failed > 0) {
						ok = false;
					}
					break;
				}
				await delay(250);
			} while (Date.now() < timeout);
			await usbDev.reset();
			if (!ok) {
				throw new Error('Test failed');
			}
		} finally {
			if (usbDev) {
				await usbDev.close();
			}
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

	async _open() {
		const timeout = Date.now() + DEVICE_OPEN_TIMEOUT;
		do {
			let usbDev = null;
			try {
				usbDev = await usb.openDeviceById(this._id);
				await usbDev.sendControlRequest(REQUEST_TYPE, JSON.stringify({ cmd: '' })); // FIXME
				return usbDev;
			} catch (e) {
				if (usbDev) {
					await usbDev.close();
				}
				await delay(250);
			}
		} while (Date.now() < timeout);
		throw new Error('Unable to open USB device');
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
			// throw new Error('No USB devices found');
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
