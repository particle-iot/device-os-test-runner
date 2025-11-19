'use strict';
const { expect } = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const chai = require('chai');
chai.use(sinonChai);

const util = require('./util');

describe('hub-cycle', () => {
	const fakePortPath = '3-3.4.2';
	let hubCycle;

	beforeEach(() => {
		delete require.cache[require.resolve('./hub-cycle')];
		hubCycle = require('./hub-cycle');
	});

	afterEach(async () => {
		sinon.restore();
	});

	it('provides parseHubAndPort()');
	it('provides isUhubctlInstalled()');
	it('provides cycleUSBwithPortPath()');

	describe('parseHubAndPort', () => {
		it('converts port path to hub and port', () => {
			expect(hubCycle.parseHubAndPort(fakePortPath)).to.eql({ hub: '3-3.4', port: '2' });
		});

		it('throws error for invalid port path without dot', () => {
			expect(() => hubCycle.parseHubAndPort('3-3')).to.throw('Invalid portPath format: 3-3');
		});
	});

	describe('isUhubctlInstalled', () => {
		it('returns true when uhubctl is found', async () => {
			sinon.stub(util, 'execCommand').resolves({ code: 0, stdout: '/usr/sbin/uhubctl' });
			const result = await hubCycle.isUhubctlInstalled();
			expect(result).to.be.true;
			expect(util.execCommand).to.have.been.calledWith('which', ['uhubctl']);
		});

		it('returns false when uhubctl is not found', async () => {
			sinon.stub(util, 'execCommand').resolves({ code: 1, stdout: '' });
			const result = await hubCycle.isUhubctlInstalled();
			expect(result).to.be.false;
		});

		it('returns false when execCommand throws an error', async () => {
			sinon.stub(util, 'execCommand').rejects(new Error('Command failed'));
			const result = await hubCycle.isUhubctlInstalled();
			expect(result).to.be.false;
		});
	});

	describe('cycleUSBwithPortPath', () => {
		it('cycles USB port when uhubctl is installed', async () => {
			const execStub = sinon.stub(util, 'execCommand');
			execStub.withArgs('which', ['uhubctl']).resolves({ code: 0, stdout: '/usr/sbin/uhubctl' });
			execStub.withArgs('uhubctl', sinon.match.array).resolves({ code: 0, stdout: 'Success' });

			await hubCycle.cycleUSBwithPortPath(fakePortPath, { delaySec: 2 });

			expect(execStub).to.have.been.calledWith('uhubctl',
				['-l', '3-3.4', '-p', '2', '-a', 'cycle', '-d', '2']);
		});

		it('logs error and returns when uhubctl is not installed', async () => {
			sinon.stub(util, 'execCommand').resolves({ code: 1, stdout: '' });
			const consoleStub = sinon.stub(console, 'error');

			await hubCycle.cycleUSBwithPortPath(fakePortPath);

			expect(consoleStub).to.have.been.calledWith(sinon.match(/uhubctl is not installed/));
		});

		it('throws error when uhubctl fails', async () => {
			const execStub = sinon.stub(util, 'execCommand');
			execStub.withArgs('which', ['uhubctl']).resolves({ code: 0, stdout: '/usr/sbin/uhubctl' });
			execStub.withArgs('uhubctl', sinon.match.array).resolves({ code: 1, stdout: 'Error output' });

			try {
				await hubCycle.cycleUSBwithPortPath(fakePortPath);
				expect.fail('Should have thrown an error');
			} catch (err) {
				expect(err.message).to.match(/uhubctl failed with code 1/);
			}
		});

		it('throws error when portPath is not provided', async () => {
			try {
				await hubCycle.cycleUSBwithPortPath(null);
				expect.fail('Should have thrown an error');
			} catch (err) {
				expect(err.message).to.equal('USB portPath required');
			}
		});
	});
});
