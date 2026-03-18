'use strict';
const { expect, sinon, log } = require('../test');
const { ApiClient } = require('./api');

describe('ApiClient', () => {
	let apiClient;

	beforeEach(async () => {
		apiClient = new ApiClient({ log });
	});

	afterEach(async () => {
		sinon.restore();
	});

	it('provides .init()');
	it('provides .shutdown()');
	it('provides .receiveEvent()');
	it('provides .setTestDevices()');
	it('provides .resetTestDevices()');
	it('provides .getDevices()');

	describe('_handleKeepAliveEvent()', () => {
		it('acknowledges this runner instance keepalive', () => {
			apiClient._instanceId = 'runner-1';
			apiClient._keepAlivePending = {
				instanceId: 'runner-1',
				nonce: 7,
				sentAt: Date.now()
			};

			apiClient._onEvent({
				name: 'device-os-test/keepalive',
				coreid: 'api',
				data: JSON.stringify({
					instanceId: 'runner-1',
					nonce: 7
				})
			});

			expect(apiClient._keepAlivePending).to.equal(null);
		});
	});

	describe('_runKeepAliveCycle()', () => {
		it('publishes keepalive with instance identifier and nonce', async () => {
			apiClient._instanceId = 'runner-1';
			sinon.stub(apiClient, 'publishEvent').resolves();
			sinon.stub(apiClient, '_scheduleKeepAlive');

			await apiClient._runKeepAliveCycle();

			expect(apiClient.publishEvent).to.have.been.calledOnce;
			expect(apiClient.publishEvent.firstCall.args[0].name).to.equal('device-os-test/keepalive');
			expect(JSON.parse(apiClient.publishEvent.firstCall.args[0].data)).to.deep.equal({
				instanceId: 'runner-1',
				nonce: 1
			});
		});

		it('reconnects when a keepalive is not observed back on the stream', async () => {
			apiClient._keepAlivePending = {
				instanceId: 'runner-1',
				nonce: 3,
				sentAt: Date.now() - 20000
			};
			sinon.stub(apiClient, '_reconnectStream').resolves();
			sinon.stub(apiClient, '_scheduleKeepAlive');

			await apiClient._runKeepAliveCycle();

			expect(apiClient._reconnectStream).to.have.been.calledOnce;
		});
	});
});
