import { platformsForTag, PLATFORMS } from './platform';

function parsePlatformTag(tag) {
	let not = false;
	if (tag.startsWith('!')) {
		tag = tag.substring(1);
		not = true;
	}
	if (tag === 'all') {
		return not ? [] : PLATFORMS;
	}
	if (not) {
		return PLATFORMS.filter(p => !p.has(tag));
	}
	return platformsForTag(tag);
}

/**
 * Parse platform tags.
 *
 * @param {Array<String>} tags Platform tags.
 * @returns {Array<Platform>}
 */
export function parsePlatformTags(tags) {
	const platforms = new Map();
	tags.forEach(tag => {
		let ps = null;
		const tags = tag.split(/\s+/);
		tags.forEach(tag => {
			const ps2 = parsePlatformTag(tag);
			if (ps) {
				// Filter out platforms not tagged with this tag
				ps = ps.filter(p => ps2.some(p2 => p2.id === p.id));
			} else {
				ps = ps2;
			}
		});
		ps.forEach(p => platforms.set(p.id, p));
	});
	return Array.from(platforms.values());
}

export class Suite {
	constructor(runner) {
		this._runner = runner;
		this._platforms = [];
	}

	setPlatforms(platforms) {
		this._platforms = platforms;
	}

	get platforms() {
		return this._platforms;
	}

	get runner() {
		return this._runner;
	}
}
