import { platformForId, isKnownPlatformId } from './platform';
import { config } from './config';

import { getDevices } from 'particle-usb';

export function isDeviceIdValid(id) {
	return /^[0-9a-f]{24}$/i.test(id);
}

export class Device {
	constructor({ id, name, platform, log }) {
		if (!isDeviceIdValid(id)) {
			throw new Error(`Invalid device ID: ${id}`);
		}
		this._id = id;
		this._name = name;
		this._platform = platform;
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
}

/**
 * Device manager.
 */
export class Devices {
	constructor({ apiClient, log }) {
		this._log = log;
		this._api = apiClient;
		this._devices = []; // Devices available for tests that don't require a fixture
		this._platforms = new Map(); // Devices indexed by platform name
		this._fixtures = new Map(); // Devices indexed by platform and fixture names
	}

	async init() {
		let devs = await this._getUsbDevices();
		await this._initDeviceNames(devs);
		devs = this._initFixtures(devs);
		this._initDevicePool(devs);
	}

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

	get apiClient() {
		return this._api;
	}

	get log() {
		return this._log;
	}

	async _getUsbDevices() {
		const devs = [];
		const usbDevs = await getDevices();
		if (usbDevs.length === 0) {
			// FIXME
			// throw new Error('No USB devices found');
		}
		this._log.debug('Detected USB devices:');
		for (let usbDev of usbDevs) {
			await usbDev.open();
			const id = usbDev.id;
			const platformId = usbDev.platformId;
			await usbDev.close();
			this._log.debug(`${id}, platform ID: ${platformId}`);
			if (!isKnownPlatformId(platformId)) {
				this._log.debug('Skipping device with an unsupported platform ID');
				continue;
			}
			const platform = platformForId(platformId);
			devs.push({ id, platform });
		}
		return devs;
	}

	async _initDeviceNames(devs) {
		this._log.verbose('Getting device info from the cloud');
		let apiDevs = await this._api.getDevices();
		apiDevs = apiDevs.reduce((map, dev) => map.set(dev.id.toLowerCase(), dev), new Map());
		devs.forEach(dev => {
			const apiDev = apiDevs.get(dev.id);
			if (apiDev && apiDev.name) {
				dev.name = apiDev.name;
			}
		});
	}

	_initFixtures(devs) {
		const devsById = devs.reduce((map, dev) => map.set(dev.id, dev), new Map());
		const devsByName = devs.reduce((map, dev) => dev.name ? map.set(dev.name, dev) : map, new Map());
		const fixtureDevIds = new Set();
		const fixtures = config.get('fixtures');
		for (let fixture of fixtures) {
			if (this._fixtures.has(fixture.name)) {
				throw new Error(`Duplicate fixture name: ${fixture.name}`);
			}
			for (let idOrName of fixture.devices) {
				let dev = devsById.get(idOrName);
				if (!dev) {
					dev = devsByName.get(idOrName);
					if (!dev) {
						throw new Error(`Device not found: ${idOrName}`);
					}
				}
				let platforms = this._fixtures.get(fixture.name);
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

	_initDevicePool(devs) {
		this._devices = devs.map(dev => new Device({ ...dev, log: this._log }));
		this._devices.forEach(dev => {
			let devs = this._platforms.get(dev.platform.name);
			if (!devs) {
				devs = [];
				this._platforms.set(dev.platform.name, devs);
			}
			devs.push(dev);
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
