'use strict';
const { expect } = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const chai = require('chai');
chai.use(sinonChai);

const { spawn } = require('child_process');
const path = require('path');

const { InterruptHandler } = require('./interrupt');

describe('InterruptHandler', () => {
	let exit;
	let shutdown;
	let handler;

	beforeEach(() => {
		exit = sinon.stub();
		shutdown = sinon.stub().resolves();
		handler = new InterruptHandler({ exit });
		handler.install(shutdown);
	});

	afterEach(() => {
		handler.uninstall();
		sinon.restore();
	});

	it('exits by re-raising the signal', async () => {
		await handler._onSignal('SIGINT');
		expect(exit).to.have.been.calledWith('SIGINT');
	});

	it('exits even if shutdown throws', async () => {
		shutdown.rejects(new Error('shutdown failed'));
		await handler._onSignal('SIGINT');
		expect(exit).to.have.been.calledWith('SIGINT');
	});

	it('exits immediately on a second signal during shutdown', async () => {
		let resolveShutdown = null;
		shutdown.returns(new Promise(resolve => {
			resolveShutdown = resolve;
		}));
		const first = handler._onSignal('SIGINT');
		handler._onSignal('SIGINT');
		resolveShutdown();
		await first;
		expect(shutdown).to.have.been.calledOnce;
		expect(exit.callCount).to.equal(2);
		expect(exit.alwaysCalledWith('SIGINT')).to.be.true;
	});

	it('registers listeners on install and removes them on uninstall', () => {
		const sigintCount = process.listenerCount('SIGINT');
		const sigtermCount = process.listenerCount('SIGTERM');
		const h = new InterruptHandler({ exit });
		h.install(shutdown);
		expect(process.listenerCount('SIGINT')).to.equal(sigintCount + 1);
		expect(process.listenerCount('SIGTERM')).to.equal(sigtermCount + 1);
		h.uninstall();
		expect(process.listenerCount('SIGINT')).to.equal(sigintCount);
		expect(process.listenerCount('SIGTERM')).to.equal(sigtermCount);
	});

	it('does not duplicate listeners when install is called twice', () => {
		const h = new InterruptHandler({ exit });
		h.install(shutdown);
		const sigintCount = process.listenerCount('SIGINT');
		h.install(shutdown);
		expect(process.listenerCount('SIGINT')).to.equal(sigintCount);
		h.uninstall();
	});

	it('does not throw when uninstall is called without install', () => {
		const h = new InterruptHandler({ exit });
		expect(() => h.uninstall()).to.not.throw();
	});

	describe('process integration', () => {
		it('terminates the process even when other code swallows SIGINT', async function () {
			this.timeout(20000);
			const script = `
				const { InterruptHandler } = require(${JSON.stringify(path.join(__dirname, 'interrupt'))});
				const h = new InterruptHandler();
				h.install(async () => {
					console.log('runner-cleanup');
				});
				process.on('SIGINT', () => {
					console.log('swallowed');
				});
				console.log('ready');
				setInterval(() => {}, 1000);
			`;
			const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
			let out = '';
			child.stdout.on('data', data => {
				out += data;
			});
			await new Promise((resolve, reject) => {
				child.stdout.on('data', data => {
					if (String(data).includes('ready')) {
						resolve();
					}
				});
				child.on('error', reject);
			});
			child.kill('SIGINT');
			const [code, sig] = await new Promise(resolve => child.on('exit', (code, signal) => resolve([code, signal])));
			expect(code).to.be.null;
			expect(sig).to.equal('SIGINT');
			expect(out).to.contain('runner-cleanup');
			expect(out).to.contain('swallowed');
		});
	});
});
