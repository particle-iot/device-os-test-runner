/**
 * Device OS platform.
 */
class Platform {
	/**
	 * Construct a platform object.
	 *
	 * @param {Object} platform Platform properties.
	 * @param {Number} platform.id Platform ID.
	 * @param {String} platform.name Platform name.
	 * @param {String} platform.displayName Display name.
	 * @param {Array<String>} platform.tags Platform tags.
	 */
	constructor({ id, name, displayName, tags }) {
		this._id = id;
		this._name = name;
		this._displayName = displayName;
		this._tags = tags;
	}

	/**
	 * Platform ID.
	 */
	get id() {
		return this._id;
	}

	/**
	 * Platform name.
	 */
	get name() {
		return this._name;
	}

	/**
	 * Display name.
	 */
	get displayName() {
		return this._displayName;
	}

	/**
	 * Platform tags.
	 */
	get tags() {
		return this._tags;
	}

	/**
	 * Check if the platform is tagged with a specific tag.
	 *
	 * @param {String} tag Platform tag.
	 * @returns {Boolean}
	 */
	has(tag) {
		if (!isKnownPlatformTag(tag)) {
			throw new Error(`Unknown platform tag: ${tag}`);
		}
		return this._tags.includes(tag);
	}

	/**
	 * This method is an alias for `has()`.
	 */
	is(tag) {
		return this.has(tag);
	}
}

/**
 * Supported Device OS platforms.
 */
const PLATFORMS = [
	{
		id: 6,
		name: 'photon',
		displayName: 'Photon',
		tags: ['photon', 'gen2', 'wifi', 'tcp']
	},
	{
		id: 8,
		name: 'p1',
		displayName: 'P1',
		tags: ['p1', 'gen2', 'wifi', 'tcp']
	},
	{
		id: 10,
		name: 'electron',
		displayName: 'Electron',
		tags: ['electron', 'gen2', 'cellular', 'udp']
	},
	{
		id: 12,
		name: 'argon',
		displayName: 'Argon',
		tags: ['argon', 'gen3', 'wifi', 'ble', 'udp']
	},
	{
		id: 13,
		name: 'boron',
		displayName: 'Boron',
		tags: ['boron', 'gen3', 'cellular', 'ble', 'udp']
	},
	// {
	// 	id: 22,
	// 	name: 'asom',
	// 	displayName: 'A SoM',
	// 	tags: ['asom', 'gen3', 'som', 'wifi', 'ble', 'udp']
	// },
	{
		id: 23,
		name: 'bsom',
		displayName: 'B SoM',
		tags: ['bsom', 'gen3', 'som', 'cellular', 'ble', 'udp']
	},
	{
		id: 25,
		name: 'b5som',
		displayName: 'B5 SoM',
		tags: ['b5som', 'gen3', 'som', 'cellular', 'ble', 'udp']
	},
	{
		id: 26,
		name: 'tracker',
		displayName: 'Tracker',
		tags: ['tracker', 'gen3', 'som', 'cellular', 'ble', 'udp', 'gps']
	},
	{
		id: 32,
		name: 'p2',
		displayName: 'P2',
		tags: ['p2', 'gen3', 'som', 'wifi', 'ble', 'udp']
	},
].map(p => new Platform(p));

const PLATFORMS_BY_ID = PLATFORMS.reduce((map, p) => map.set(p.id, p), new Map());
const PLATFORMS_BY_NAME = PLATFORMS.reduce((map, p) => map.set(p.name, p), new Map());

const PLATFORMS_BY_TAG = PLATFORMS.reduce((map, p) => {
	p.tags.forEach(tag => {
		let ps = map.get(tag);
		if (!ps) {
			ps = [];
			map.set(tag, ps);
		}
		ps.push(p);
	});
	return map;
}, new Map());

/**
 * Known platform tags.
 */
const PLATFORM_TAGS = Array.from(PLATFORMS_BY_TAG.keys());

/**
 * Get platform by ID.
 *
 * @param {Number} id Platform ID.
 * @returns {Platform}
 */
function platformForId(id) {
	const p = PLATFORMS_BY_ID.get(id);
	if (!p) {
		throw new Error(`Unknown platform ID: ${id}`);
	}
	return p;
}

/**
 * Check if the given platform ID is valid.
 *
 * @param {Number} id Platform ID.
 * @returns {Boolean}
 */
function isKnownPlatformId(id) {
	return PLATFORMS_BY_ID.has(id);
}

/**
 * Get platform by name.
 *
 * @param {String} name Platform name.
 * @returns {Platform}
 */
function platformForName(name) {
	const p = PLATFORMS_BY_NAME.get(name);
	if (!p) {
		throw new Error(`Unknown platform name: ${name}`);
	}
	return p;
}

/**
 * Check if the given platform name is valid.
 *
 * @param {String} name Platform name.
 * @returns {Boolean}
 */
function isKnownPlatformName(name) {
	return PLATFORMS_BY_NAME.has(name);
}

/**
 * Get platforms tagged with a specific tag.
 *
 * @param {String} tag Platform tag.
 * @returns {Array<Platform>}
 */
function platformsForTag(tag) {
	const ps = PLATFORMS_BY_TAG.get(tag);
	if (!ps) {
		throw new Error(`Unknown platform tag: ${tag}`);
	}
	return ps;
}

/**
 * Check if the given platform tag is valid.
 *
 * @param {String} tag Platform tag.
 * @returns {Boolean}
 */
function isKnownPlatformTag(tag) {
	return PLATFORMS_BY_TAG.has(tag);
}

module.exports = {
	Platform,
	PLATFORMS,
	PLATFORM_TAGS,
	platformForId,
	isKnownPlatformId,
	platformForName,
	isKnownPlatformName,
	platformsForTag,
	isKnownPlatformTag
};
