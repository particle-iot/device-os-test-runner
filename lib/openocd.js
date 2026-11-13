'use strict';
const { OpenOcdFlashInterface } = require('@particle/device-os-flash-util/lib/openocd');
const { Logger, LogLevel } = require('@particle/device-os-flash-util/lib/log');
const { config } = require('./config');

async function resetWithOpenOcd(deviceId, log) {
	if (!config.get('openocdReset')) {
		log.warn('Skipping OpenOCD reset: --openocd-reset not set');
		return false;
	}

	if (!deviceId) {
		log.warn('Skipping OpenOCD reset: Device ID not specified');
		return false;
	}

	deviceId = deviceId.toLowerCase();

	// Priority is openocdAdapterMap > openocdAdapterSerial > search for any adapter that matches the deviceId
	const map = config.get('openocdAdapterMap');
	const mapSerial = Object.entries(map).find(([id]) => id.toLowerCase() === deviceId)?.[1];
	const serial = mapSerial || config.get('openocdAdapterSerial') || null;

	const openOcdLogger = new Logger({ level: LogLevel.VERBOSE });
	const openocd = new OpenOcdFlashInterface({ log: openOcdLogger });
	await openocd.init();
	const adapters = await openocd.listDevices();
	let adapter = null;

	if (serial) {
		adapter = adapters.find(a => a.serialNumber === serial);
		if (!adapter) {
			log.error(`Skipping OpenOCD reset: Debugger serial ${serial} not found`);
			return false;
		}
		try {
			adapter.id = deviceId;
			await adapter.open();
			await adapter.reset();
		} finally {
			await adapter.close();
		}
	} else {
		// If none, search adapters for the desired device to reset
		// NOTE: this will potentially reset any other devices that may be attached as well
		for (const ad of adapters) {
			try {
				await ad.open();
				if (ad.id === deviceId) {
					adapter = ad;
					await ad.reset();
					break;
				}
			} catch (err) {
				log.verbose(`OpenOCD: adapter ${ad.serialNumber} threw while searching for ${deviceId}: ${err.message}`);
				if (adapter) {
					throw err;
				}
			} finally {
				await ad.close();
			}
		}
	}

	if (!adapter) {
		log.error(`Skipping OpenOCD reset: Debugger for ${deviceId} not found`);
		return false;
	}

	await openocd.shutdown();
	return true;
}

module.exports = {
	resetWithOpenOcd
};
