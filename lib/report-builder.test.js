'use strict';
const { expect } = require('../test');
const { ReportBuilder } = require('./report-builder');
const Mocha = require('mocha');

describe('ReportBuilder', () => {
	describe('build()', () => {
		it('groups tests by device into the final structure', () => {
			const srcSuite = new Mocha.Suite('MySuite');
			srcSuite.particle = { file: 'my_suite/my_suite.spec.js', suiteRetries: 0 };
			const platSuite = new Mocha.Suite('boron');
			platSuite.particle = { platform: { name: 'boron' }, fixtures: [], file: 'my_suite/my_suite.spec.js' };
			const configSuite = new Mocha.Suite('systemThread=disabled');
			configSuite.particle = { platform: { name: 'boron' }, systemThread: 'disabled', systemMode: 'semi-automatic', file: 'my_suite/my_suite.spec.js' };
			configSuite.parent = platSuite;
			platSuite.parent = srcSuite;

			const allReportData = [{
				start: '2026-04-16T10:00:00.000Z',
				end: '2026-04-16T10:00:10.000Z',
				attempt: 1,
				tests: [{
					name: 'test_a',
					fullTitle: 'MySuite boron systemThread=disabled test_a',
					state: 'passed',
					duration: 500,
					parent: configSuite,
					particle: {
						suiteRetries: 0,
						devices: [{ id: 'dev1', name: 'boron-1', platform: 'boron' }]
					}
				}]
			}];

			const builder = new ReportBuilder();
			const report = builder.build(allReportData);

			expect(report.version).to.equal(1);
			expect(report.stats.tests).to.equal(1);
			expect(report.stats.passes).to.equal(1);
			expect(report.stats.failures).to.equal(0);
			expect(report.devices).to.have.length(1);
			expect(report.devices[0].id).to.equal('dev1');
			expect(report.devices[0].platform).to.equal('boron');
			expect(report.devices[0].suites).to.have.length(1);
			expect(report.devices[0].suites[0].name).to.equal('MySuite');
			expect(report.devices[0].suites[0].path).to.equal('my_suite');
			expect(report.devices[0].suites[0].configurations).to.have.length(1);
			expect(report.devices[0].suites[0].configurations[0].systemThread).to.equal('disabled');
			expect(report.devices[0].suites[0].configurations[0].attempts).to.have.length(1);
			expect(report.devices[0].suites[0].configurations[0].attempts[0].passed).to.equal(true);
		});

		it('handles tests without device info using platform as fallback', () => {
			const srcSuite = new Mocha.Suite('SuiteNoDevices');
			srcSuite.particle = { file: 'nod/nod.spec.js', suiteRetries: 0 };
			const platSuite = new Mocha.Suite('boron');
			platSuite.particle = { platform: { name: 'boron' }, fixtures: [], file: 'nod/nod.spec.js' };
			const configSuite = new Mocha.Suite('systemThread=enabled');
			configSuite.particle = { platform: { name: 'boron' }, systemThread: 'enabled', systemMode: 'semi-automatic', file: 'nod/nod.spec.js' };
			configSuite.parent = platSuite;
			platSuite.parent = srcSuite;

			const allReportData = [{
				start: '2026-04-16T10:00:00.000Z',
				end: '2026-04-16T10:00:10.000Z',
				attempt: 1,
				tests: [{
					name: 'test_no_device',
					fullTitle: 'SuiteNoDevices boron systemThread=enabled test_no_device',
					state: 'failed',
					duration: 300,
					parent: configSuite,
					particle: {
						suiteRetries: 0
					}
				}]
			}];

			const builder = new ReportBuilder();
			const report = builder.build(allReportData);

			expect(report.stats.tests).to.equal(1);
			expect(report.stats.failures).to.equal(1);
			expect(report.devices).to.have.length(1);
			expect(report.devices[0].id).to.equal('boron');
			expect(report.devices[0].suites[0].configurations[0].attempts[0].passed).to.equal(false);
		});

		it('groups multiple attempts under the same configuration', () => {
			const srcSuite = new Mocha.Suite('RetrySuite');
			srcSuite.particle = { file: 'retry/retry.spec.js', suiteRetries: 2 };
			const platSuite = new Mocha.Suite('boron');
			platSuite.particle = { platform: { name: 'boron' }, fixtures: [], file: 'retry/retry.spec.js' };
			const configSuite = new Mocha.Suite('systemThread=disabled');
			configSuite.particle = { platform: { name: 'boron' }, systemThread: 'disabled', systemMode: 'semi-automatic', file: 'retry/retry.spec.js' };
			configSuite.parent = platSuite;
			platSuite.parent = srcSuite;

			const allReportData = [
				{
					start: '2026-04-16T10:00:00.000Z',
					end: '2026-04-16T10:00:10.000Z',
					attempt: 1,
					sourceSuite: 'RetrySuite',
					tests: [{
						name: 'test_retry',
						fullTitle: 'RetrySuite boron systemThread=disabled test_retry',
						state: 'failed',
						duration: 100,
						parent: configSuite,
						particle: { suiteRetries: 2, devices: [{ id: 'd1', name: 'boron-1', platform: 'boron' }] }
					}]
				},
				{
					start: '2026-04-16T10:00:10.000Z',
					end: '2026-04-16T10:00:20.000Z',
					attempt: 2,
					sourceSuite: 'RetrySuite',
					tests: [{
						name: 'test_retry',
						fullTitle: 'RetrySuite boron systemThread=disabled test_retry',
						state: 'passed',
						duration: 80,
						parent: configSuite,
						particle: { suiteRetries: 2, devices: [{ id: 'd1', name: 'boron-1', platform: 'boron' }] }
					}]
				}
			];

			const builder = new ReportBuilder();
			const report = builder.build(allReportData);

			expect(report.stats.tests).to.equal(2);
			expect(report.stats.passes).to.equal(1);
			expect(report.stats.failures).to.equal(1);
			const attempts = report.devices[0].suites[0].configurations[0].attempts;
			expect(attempts).to.have.length(2);
			expect(attempts[0].attempt).to.equal(1);
			expect(attempts[0].passed).to.equal(false);
			expect(attempts[1].attempt).to.equal(2);
			expect(attempts[1].passed).to.equal(true);
		});

		it('handles empty report data', () => {
			const builder = new ReportBuilder();
			const report = builder.build([]);
			expect(report.stats.tests).to.equal(0);
			expect(report.devices).to.have.length(0);
		});

		it('handles skipped tests', () => {
			const srcSuite = new Mocha.Suite('SkipSuite');
			srcSuite.particle = { file: 'skip/skip.spec.js', suiteRetries: 0 };
			const platSuite = new Mocha.Suite('argon');
			platSuite.particle = { platform: { name: 'argon' }, fixtures: [], file: 'skip/skip.spec.js' };
			const configSuite = new Mocha.Suite('systemThread=enabled');
			configSuite.particle = { platform: { name: 'argon' }, systemThread: 'enabled', systemMode: 'semi-automatic', file: 'skip/skip.spec.js' };
			configSuite.parent = platSuite;
			platSuite.parent = srcSuite;

			const allReportData = [{
				start: '2026-04-16T10:00:00.000Z',
				end: '2026-04-16T10:00:05.000Z',
				attempt: 1,
				tests: [{
					name: 'test_skipped',
					fullTitle: 'SkipSuite argon systemThread=enabled test_skipped',
					state: 'skipped',
					duration: 0,
					parent: configSuite,
					particle: { suiteRetries: 0, devices: [{ id: 'sk1', name: 'argon-1', platform: 'argon' }] }
				}]
			}];

			const builder = new ReportBuilder();
			const report = builder.build(allReportData);

			expect(report.stats.skipped).to.equal(1);
			expect(report.devices[0].suites[0].configurations[0].attempts[0].passed).to.equal(true);
		});

		it('groups tests from same suite across different configurations', () => {
			const srcSuite = new Mocha.Suite('MultiConfigSuite');
			srcSuite.particle = { file: 'multi/multi.spec.js', suiteRetries: 0 };
			const platSuite = new Mocha.Suite('boron');
			platSuite.particle = { platform: { name: 'boron' }, fixtures: [], file: 'multi/multi.spec.js' };

			const configSuite1 = new Mocha.Suite('systemThread=enabled');
			configSuite1.particle = { platform: { name: 'boron' }, systemThread: 'enabled', systemMode: 'semi-automatic', file: 'multi/multi.spec.js' };
			configSuite1.parent = platSuite;

			const configSuite2 = new Mocha.Suite('systemThread=disabled');
			configSuite2.particle = { platform: { name: 'boron' }, systemThread: 'disabled', systemMode: 'semi-automatic', file: 'multi/multi.spec.js' };
			configSuite2.parent = platSuite;

			platSuite.parent = srcSuite;

			const allReportData = [{
				start: '2026-04-16T10:00:00.000Z',
				end: '2026-04-16T10:00:20.000Z',
				attempt: 1,
				tests: [
					{
						name: 'test_thread_enabled',
						fullTitle: 'MultiConfigSuite boron systemThread=enabled test_thread_enabled',
						state: 'passed',
						duration: 100,
						parent: configSuite1,
						particle: { suiteRetries: 0, devices: [{ id: 'd1', name: 'boron-1', platform: 'boron' }] }
					},
					{
						name: 'test_thread_disabled',
						fullTitle: 'MultiConfigSuite boron systemThread=disabled test_thread_disabled',
						state: 'passed',
						duration: 120,
						parent: configSuite2,
						particle: { suiteRetries: 0, devices: [{ id: 'd1', name: 'boron-1', platform: 'boron' }] }
					}
				]
			}];

			const builder = new ReportBuilder();
			const report = builder.build(allReportData);

			expect(report.stats.tests).to.equal(2);
			expect(report.devices).to.have.length(1);
			expect(report.devices[0].suites).to.have.length(1);
			expect(report.devices[0].suites[0].configurations).to.have.length(2);
		});
	});

	describe('_extractSuiteInfo()', () => {
		it('walks up the suite hierarchy to extract metadata', () => {
			const srcSuite = new Mocha.Suite('MySuite');
			srcSuite.particle = { file: 'my_suite/my_suite.spec.js', suiteRetries: 3 };
			const platSuite = new Mocha.Suite('boron');
			platSuite.particle = { platform: { name: 'boron' }, fixtures: [{ name: 'myFixture' }], file: 'my_suite/my_suite.spec.js' };
			const configSuite = new Mocha.Suite('systemThread=disabled');
			configSuite.particle = { platform: { name: 'boron' }, systemThread: 'disabled', systemMode: 'semi-automatic', file: 'my_suite/my_suite.spec.js' };
			configSuite.parent = platSuite;
			platSuite.parent = srcSuite;

			const builder = new ReportBuilder();
			const result = builder._extractSuiteInfo({ parent: configSuite, particle: {} });

			expect(result.file).to.equal('my_suite/my_suite.spec.js');
			expect(result.suiteName).to.equal('MySuite');
			expect(result.platform).to.equal('boron');
			expect(result.systemThread).to.equal('disabled');
			expect(result.systemMode).to.equal('semi-automatic');
			expect(result.fixture).to.equal('myFixture');
			expect(result.retries).to.equal(3);
			expect(result.suitePath).to.equal('my_suite');
		});

		it('uses test.particle.suiteRetries as override', () => {
			const srcSuite = new Mocha.Suite('Suite');
			srcSuite.particle = { file: 'x/x.spec.js', suiteRetries: 1 };
			const platSuite = new Mocha.Suite('argon');
			platSuite.particle = { platform: { name: 'argon' }, fixtures: [], file: 'x/x.spec.js' };
			platSuite.parent = srcSuite;

			const builder = new ReportBuilder();
			const result = builder._extractSuiteInfo({ parent: platSuite, particle: { suiteRetries: 5 } });

			expect(result.retries).to.equal(5);
		});
	});
});
