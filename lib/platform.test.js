const sinon = require('sinon');
const { expect } = require('../test');
const { PLATFORMS, Platform, platformForName } = require('./platform');

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
			p2: ['p2', 'gen3', 'wifi', 'ble', 'udp', 'rtl872x'],
			tracker: ['tracker', 'gen3', 'som', 'cellular', 'ble', 'udp', 'gnss', 'nrf52840'],
			trackerm: ['trackerm', 'gen3', 'som', 'cellular', 'ble', 'udp', 'gnss', 'rtl872x'],
			msom: ['msom', 'gen3', 'cellular', 'ble', 'udp', 'gnss', 'rtl872x'],
			b5som: ['b5som', 'gen3', 'som', 'cellular', 'ble', 'udp', 'mesh', 'nrf52840'],
			bsom: ['bsom', 'gen3', 'som', 'cellular', 'ble', 'udp', 'mesh', 'nrf52840'],
			boron: ['boron', 'gen3', 'cellular', 'ble', 'udp', 'mesh', 'nrf52840'],
			argon: ['argon', 'gen3', 'wifi', 'ble', 'udp', 'mesh', 'nrf52840'],
			electron: ['electron', 'gen2', 'cellular', 'udp', 'stm32f2xx'],
			p1: ['p1', 'gen2', 'wifi', 'tcp', 'stm32f2xx'],
			photon: ['photon', 'gen2', 'wifi', 'tcp', 'stm32f2xx']
		};
		it('provides all expected data for p2', () => {
			const p2 = platformForName('p2');
			expect(p2).to.be.an.instanceOf(Platform);
			expect(p2.id).to.eql(32);
			expect(p2.name).to.eql('p2');
			expect(p2.displayName).to.eql('Photon 2 / P2');
			expect(p2.tags).to.include.members(expectedTags.p2);
		});

		it('provides all expected data for trackerm', () => {
			const trackerm = platformForName('trackerm');
			expect(trackerm).to.be.an.instanceOf(Platform);
			expect(trackerm.id).to.eql(28);
			expect(trackerm.name).to.eql('trackerm');
			expect(trackerm.displayName).to.eql('Tracker M');
			expect(trackerm.tags).to.include.members(expectedTags.trackerm);
		});

		it('provides all expected data for msom', () => {
			const msom = platformForName('msom');
			expect(msom).to.be.an.instanceOf(Platform);
			expect(msom.id).to.eql(35);
			expect(msom.name).to.eql('msom');
			expect(msom.displayName).to.eql('M SoM');
			expect(msom.tags).to.include.members(expectedTags.msom);
		});

		it('provides correct tags for tracker', () => {
			const p = platformForName('tracker');
			expect(p.tags).to.include.members(expectedTags.tracker);
		});

		it('provides correct tags for b5som', () => {
			const p = platformForName('b5som');
			expect(p.tags).to.include.members(expectedTags.b5som);
		});

		it('provides correct tags for bsom', () => {
			const p = platformForName('bsom');
			expect(p.tags).to.include.members(expectedTags.bsom);
		});

		it('provides correct tags for boron', () => {
			const p = platformForName('boron');
			expect(p.tags).to.include.members(expectedTags.boron);
		});

		it('provides correct tags for argon', () => {
			const p = platformForName('argon');
			expect(p.tags).to.include.members(expectedTags.argon);
		});

		it('provides correct tags for electron', () => {
			const p = platformForName('electron');
			expect(p.tags).to.include.members(expectedTags.electron);
		});

		it('provides correct tags for p1', () => {
			const p = platformForName('p1');
			expect(p.tags).to.include.members(expectedTags.p1);
		});

		it('provides correct tags for photon', () => {
			const p = platformForName('photon');
			expect(p.tags).to.include.members(expectedTags.photon);
		});
	});
});
