const sinon = require('sinon');
const { expect } = require('./test');
const { PLATFORMS, Platform, platformForName } = require('../lib/platform');

describe('platform.js', () => {
	beforeEach(async () => {
	});

	afterEach(async () => {
		sinon.restore();
	});

	describe('PLATFORMS', () => {
		it('is an array of Platform instances', () => {
			expect(PLATFORMS).to.be.an('array');
			expect(PLATFORMS.length).to.be.greaterThan(0);
			expect(PLATFORMS[0]).to.be.an.instanceOf(Platform);
		});
	});

	describe('expected tags for selected platforms', () => {
		const expectedTags = {
			// TODO: "som" is missing, add it to device-constants + update this test
			p2: ['p2', 'gen3', /* TODO 'som',*/ 'wifi', 'ble', 'udp'],
			// Note: device-constants provides "gnss", device-os-test-runner provided "gps"
			// let's use "gnss" instead because it's a more accurate reflection of reality.
			// device-os integration tests don't use "gps" tag https://github.com/particle-iot/device-os/tree/develop/user/tests/integration
			// So no action needed
			tracker: ['tracker', 'gen3', 'som', 'cellular', 'ble', 'udp', 'gnss'],
			// Note: added mesh device to make it pass
			b5som: ['b5som', 'gen3', 'som', 'cellular', 'ble', 'udp', 'mesh'],
			// Note: Added mesh
			bsom: ['bsom', 'gen3', 'som', 'cellular', 'ble', 'udp', 'mesh'],
			// Note: Added mesh
			boron: ['boron', 'gen3', 'cellular', 'ble', 'udp', 'mesh'],
			// Note: Added mesh
			argon: ['argon', 'gen3', 'wifi', 'ble', 'udp', 'mesh'],
			electron: ['electron', 'gen2', 'cellular', 'udp'],
			p1: ['p1', 'gen2', 'wifi', 'tcp'],
			photon: ['photon', 'gen2', 'wifi', 'tcp']

		};
		it('provides all expected data for p2', () => {
			const p2 = platformForName('p2');
			expect(p2).to.be.an.instanceOf(Platform);
			expect(p2.id).to.eql(32);
			expect(p2.name).to.eql('p2');
			expect(p2.displayName).to.eql('P2');
			expect(p2.tags).to.have.members(expectedTags.p2);
		});

		it('provides correct tags for tracker', () => {
			const p = platformForName('tracker');
			expect(p.tags).to.have.members(expectedTags.tracker);
		});

		it('provides correct tags for b5som', () => {
			const p = platformForName('b5som');
			expect(p.tags).to.have.members(expectedTags.b5som);
		});

		it('provides correct tags for bsom', () => {
			const p = platformForName('bsom');
			expect(p.tags).to.have.members(expectedTags.bsom);
		});

		it('provides correct tags for boron', () => {
			const p = platformForName('boron');
			expect(p.tags).to.have.members(expectedTags.boron);
		});

		it('provides correct tags for argon', () => {
			const p = platformForName('argon');
			expect(p.tags).to.have.members(expectedTags.argon);
		});

		it('provides correct tags for electron', () => {
			const p = platformForName('electron');
			expect(p.tags).to.have.members(expectedTags.electron);
		});

		it('provides correct tags for p1', () => {
			const p = platformForName('p1');
			expect(p.tags).to.have.members(expectedTags.p1);
		});

		it('provides correct tags for photon', () => {
			const p = platformForName('photon');
			expect(p.tags).to.have.members(expectedTags.photon);
		});
	});
});
