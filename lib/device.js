import { platformForId, isValidPlatformId, PLATFORMS } from './platform';
import { isValidDeviceId, delay } from './util';
import { config } from './config';

import * as usb from 'particle-usb';

import * as fs from 'fs';

const DEVICE_OPEN_TIMEOUT = 5000;
const DEFAULT_TEST_TIMEOUT = 30000;
const REQUEST_TYPE = 10; // CTRL_REQUEST_APP_CUSTOM

export class Device {
	constructor({ id, name, platform, log }) {
		if (!isValidDeviceId(id)) {
			throw new Error(`Invalid device ID: ${id}`);
		}
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
			name = name.replace(/\s+/g, '_').toLowerCase();
			this._log.verbose(`Running test: ${name}`);
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
		this._deviceIndex = null; // Devices by platform ID
		this._devices = null; // All available devices
	}

	async init() {
		this._log.verbose('Enumerating USB devices');
		const devs = await this._listUsbDevices();
		if (!devs.length) {
			throw new Error('No USB devices found');
		}
		await this._initDeviceInfo(devs);
		devs.forEach(dev => {
			this._log.verbose(deviceDisplayName(dev.id, dev.name));
		});
		const enabledPlatforms = new Map(); // Enabled platforms by ID
		config.get('platforms').forEach(tag => {
			const ps = platformsForTag(tag);
			ps.forEach(p => enabledPlatforms.set(p.id, p));
		});
		devs.forEach(dev => {
			this._log.verbose(`${dev.id}, platform ID: ${platform.id}`);
		});
		this._initDeviceIndex(devs, enabledPlatforms);
	}

	async shutdown() {
	}

	device({ platform, fixtureName }) {
	}
/*
	forPlatform(platformName) {
		const devs = this._platforms.get(platformName);
		if (!devs || devs.length === 0) {
			return null;
		}
		// Get the next device and move it to the back of the queue
		const dev = devs.shift();
		devs.push(dev);
		return dev;
	}

	forFixture(fixtureName, platformName) {
		const platforms = this._fixtures.get(fixtureName);
		if (!platforms) {
			return null;
		}
		const devs = platforms.get(platformName);
		if (!devs || devs.length === 0) {
			return null;
		}
		// Get the next device and move it to the back of the queue
		const dev = devs.shift();
		devs.push(dev);
		return dev;
	}
*/
	async _listUsbDevices() {
		const devs = [];
		const usbDevs = await usb.getDevices();
		for (let usbDev of usbDevs) {
			await usbDev.open();
			const id = usbDev.id;
			const platformId = usbDev.platformId;
			await usbDev.close();
			if (!isValidPlatformId(platformId)) {
				this._log.warn(`Skipping a device with an unsupported platform ID: ${platformId}`);
				continue;
			}
			const platform = platformForId(platformId);
			devs.push({ id, platform });
		}
		return devs;
	}

	async _initDeviceInfo(devs) {
		this._log.verbose('Getting device list from the cloud');
		let apiDevs = await this._api.getDevices();
		apiDevs = apiDevs.reduce((map, dev) => map.set(dev.id.toLowerCase(), dev), new Map());
		devs.forEach(dev => {
			const apiDev = apiDevs.get(dev.id);
			if (apiDev && apiDev.name) {
				dev.name = apiDev.name;
			}
		});
	}

	_initDeviceIndex(devs, enabledPlatforms) {
		const devsById = devs.reduce((map, dev) => map.set(dev.id, dev), new Map());
		const devsByName = devs.reduce((map, dev) => dev.name ? map.set(dev.name, dev) : map, new Map());
		const fixtureDevIds = new Set();
		const fixtures = config.get('fixtures');
		for (let fixture of fixtures) {
			if (this._fixtures.has(fixture.name)) {
				throw new Error(`${fixture.name}: Duplicate fixture name`);
			}
			let supportedPlatforms = parsePlatforms(fixture.platforms);
			if (supportedPlatforms.length === 0) {
				throw new Error(`${fixture.name}: Supported platforms are not specified`);
			}
			supportedPlatforms = supportedPlatforms.reduce((set, p) => set.add(p.id), new Set());
			for (let idOrName of fixture.devices) {
				let dev = devsById.get(idOrName);
				if (!dev) {
					dev = devsByName.get(idOrName);
					if (!dev) {
						throw new Error(`${fixture.name}: Device not found: ${idOrName}`);
					}
				}
				if (enabledPlatforms.size > 0 && !enabledPlatforms.has(dev.platform.id)) {
					continue;
				}
				if (supportedPlatforms.size > 0 && !supportedPlatforms.has(dev.platform.id)) {
					throw new Error(`${fixture.name}: Device platform is not supported: ${idOrName}`);
				}
				let platforms = this._fixtures.get(fixture.name); // Fixture devices by platform name
				if (!platforms) {
					platforms = new Map();
					this._fixtures.set(fixture.name, platforms);
				}
				let fixtureDevs = platforms.get(dev.platform.name);
				if (!fixtureDevs) {
					fixtureDevs = [];
					platforms.set(dev.platform.name, fixtureDevs);
				}
				fixtureDevs.push(new Device({ ...dev, log: this._log }));
				fixtureDevIds.add(dev.id);
			}
		}
		if (this._fixtures.size > 0) {
			this._log.debug('Device fixtures:');
			this._fixtures.forEach((platforms, fixtureName) => {
				this._log.debug(`${fixtureName}:`);
				platforms.forEach(devs => {
					devs.forEach(dev => this._log.debug(dev.displayName));
				});
			});
		} else {
			this._log.verbose('No device fixtures configured');
		}
		devs = devs.filter(dev => !fixtureDevIds.has(dev.id));
		return devs;
	}

	_initDevicePool(devs, enabledPlatforms) {
		let enabledDevs = config.get('devices');
		// TODO: Make sure all enabled devices are attached to the system
		enabledDevs = enabledDevs.reduce((set, idOrName) => set.add(idOrName), new Set());
		devs = devs.filter(dev => {
			if (enabledDevs.size > 0 && !enabledDevs.has(dev.id) && (!dev.name || !enabledDevs.has(dev.name))) {
				return false;
			}
			if (enabledPlatforms.size > 0 && !enabledPlatforms.has(dev.platform.id)) {
				return false;
			}
			return true;
		});
		this._devices = devs.map(dev => new Device({ ...dev, log: this._log }));
		this._devices.forEach(dev => {
			let platformDevs = this._platforms.get(dev.platform.name); // Devices by platform name
			if (!platformDevs) {
				platformDevs = [];
				this._platforms.set(dev.platform.name, platformDevs);
			}
			platformDevs.push(dev);
		});
		if (this._devices.length > 0) {
			this._log.debug('Device pool:');
			this._devices.forEach(dev => {
				this._log.debug(dev.displayName);
			});
		} else {
			this._log.warn('Device pool is empty');
		}
	}
}
