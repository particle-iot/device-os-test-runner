'use strict';

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const elfy = require('elfy');
const { Addr2Line } = require('addr2line');

// FirmwareModuleType values (proto_defs/shared/cloud/describe.proto)
const MODULE_TYPE_SYSTEM_PART = 4;
const MODULE_TYPE_USER_PART = 5;

// SHA-256 of a firmware module: the last 32 bytes of the module_info_suffix section are the
// hash, followed by the 2 byte suffix size (module_info_suffix_base_t, see dynalib/inc/module_info.h)
function readModuleElfHash(elfPath) {
	const elf = elfy.parse(fs.readFileSync(elfPath));
	if (!elf || !elf.body || !elf.body.sections) {
		throw new Error('not an ELF');
	}
	const section = elf.body.sections.find((s) => s.name === '.module_info_suffix');
	if (!section || !section.data || section.data.length < 34) {
		throw new Error('no .module_info_suffix section');
	}
	return section.data.slice(section.data.length - 34, section.data.length - 34 + 32);
}

// Resolves panic addresses to file:line and function names using the DWARF info of the
// firmware modules built for the device under test. When the hashes of the modules flashed
// to the device are known (getModuleInfo), only ELF files carrying a matching hash are used;
// otherwise every candidate ELF is tried per address.
class PanicResolver {
	constructor({ log, deviceOsDir, binaryDir, elfDirs }) {
		this._log = log;
		this._deviceOsDir = deviceOsDir || null;
		this._binaryDir = binaryDir || null;
		this._elfDirs = elfDirs || null;
		this._binaries = []; // ELFs registered explicitly, e.g. the flashed test app
		this._resolver = null;
	}

	// Registers an ELF to search, e.g. the app binary flashed to the device. Has no effect
	// after the first resolve() call, which is when the DWARF parsers are built
	addElf(path) {
		if (this._resolver) {
			this._log.debug('Panic resolver: addElf() ignored, already initialized');
			return;
		}
		if (!this._binaries.includes(path)) {
			this._binaries.push(path);
		}
	}

	_resolverLazy(moduleHashes) {
		if (!this._resolver) {
			const candidates = this._candidateElfs();
			let binaries = candidates;
			if (moduleHashes) {
				// Only keep the ELFs whose module hash matches what is flashed on the device;
				// symbolication against a stale ELF produces wrong file:line results
				const wanted = moduleHashes;
				binaries = [];
				const matchedTypes = new Set();
				for (const file of candidates) {
					try {
						const hash = readModuleElfHash(file);
						let matched = false;
						for (const type of Object.keys(wanted)) {
							if (wanted[type].toString('hex') === hash.toString('hex')) {
								matchedTypes.add(Number(type));
								matched = true;
							}
						}
						if (matched && !binaries.includes(file)) {
							binaries.push(file);
						}
					} catch (_err) {
						// Not a firmware module ELF or unreadable - skip silently
					}
				}
				// Missing ELFs for modules running on the device mean no or wrong
				// symbolication for their addresses: worth a warning
				if (wanted[MODULE_TYPE_SYSTEM_PART] && !matchedTypes.has(MODULE_TYPE_SYSTEM_PART)) {
					this._log.warn('Panic resolver: no ELF found for the system part of the device');
				}
				if (wanted[MODULE_TYPE_USER_PART] && !matchedTypes.has(MODULE_TYPE_USER_PART)) {
					this._log.warn('Panic resolver: no ELF found for the test application of the device');
				}
			}
			this._resolver = new Addr2Line(binaries);
		}
		return this._resolver;
	}

	_candidateElfs() {
		const paths = new Set();
		const add = (p) => {
			if (p && fs.existsSync(p)) {
				paths.add(p);
			}
		};
		// The app ELF registered at flash time comes first
		for (const file of this._binaries) {
			add(file);
		}
		if (this._binaryDir) {
			for (const file of glob.sync('**/*.elf', { cwd: this._binaryDir, nodir: true, absolute: true })) {
				add(file);
			}
		}
		if (this._elfDirs) {
			for (const dir of this._elfDirs) {
				for (const file of glob.sync('**/*.elf', { cwd: dir, nodir: true, absolute: true })) {
					add(file);
				}
			}
		}
		if (this._deviceOsDir) {
			const sysDir = path.join(this._deviceOsDir, 'build', 'target', 'system-part1');
			for (const file of glob.sync('**/*.elf', { cwd: sysDir, nodir: true, absolute: true })) {
				add(file);
			}
		}
		return Array.from(paths);
	}

	async resolve(address) {
		if (typeof address === 'string') {
			address = parseInt(address, 16);
		}
		if (!Number.isFinite(address) || address <= 0) {
			return null;
		}
		const resolver = this._resolverLazy(null);
		try {
			const r = await resolver.resolve(address);
			if (r && r.filename) {
				return r;
			}
		} catch (err) {
			this._log.debug(`Panic resolver: failed to resolve 0x${address.toString(16)}: ${err.message}`);
		}
		return null;
	}

	// Symbolicates a panic info structure. Returns a new object with the decoded fields
	// appended, leaving the raw values intact. moduleHashes are the hashes of the modules
	// flashed to the device (see Device.getModuleHashes()), used to pick the matching ELFs
	async symbolicatePanicInfo(info, moduleHashes = null) {
		this._resolverLazy(moduleHashes);
		const out = { ...info };
		const addrs = [out.pc, out.lr, ...(out.registers || [])];
		const decoded = {};
		for (const a of addrs) {
			if (a === undefined || a === null) {
				continue;
			}
			const r = await this.resolve(a);
			if (r) {
				decoded[a] = `${r.function || '?'} at ${r.filename}:${r.line}`;
			}
		}
		if (Object.keys(decoded).length) {
			out.decoded = decoded;
			if (decoded[out.pc]) {
				out.pcDecoded = decoded[out.pc];
			}
			if (decoded[out.lr]) {
				out.lrDecoded = decoded[out.lr];
			}
		}
		return out;
	}
}

module.exports = {
	PanicResolver
};
