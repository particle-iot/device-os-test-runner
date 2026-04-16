'use strict';

const path = require('path');

class ReportBuilder {
	build(allReportData) {
		const devices = new Map();
		let totalTests = 0;
		let totalPasses = 0;
		let totalFailures = 0;
		let totalSkipped = 0;
		let totalDuration = 0;
		const startTime = allReportData[0] && allReportData[0].start;
		const endTime = allReportData[allReportData.length - 1] && allReportData[allReportData.length - 1].end;
		const suiteNames = new Set();

		for (const runData of allReportData) {
			if (!runData || !runData.tests) {
				continue;
			}
			for (const test of runData.tests) {
				totalTests++;
				if (test.state === 'passed') {
					totalPasses++;
				} else if (test.state === 'failed') {
					totalFailures++;
				} else if (test.state === 'skipped') {
					totalSkipped++;
				}
				if (test.duration) {
					totalDuration += test.duration;
				}

				const suiteInfo = this._extractSuiteInfo(test);
				if (suiteInfo.file) {
					suiteNames.add(suiteInfo.file);
				}

				const particle = test.particle || {};
				const deviceList = particle.devices && particle.devices.length
					? particle.devices
					: [{ id: suiteInfo.platform || 'unknown', name: null, platform: suiteInfo.platform || null }];

				for (const dev of deviceList) {
					const devKey = dev.id || 'unknown';
					const devPlatform = typeof dev.platform === 'object' && dev.platform !== null
						? dev.platform.name
						: (dev.platform || suiteInfo.platform || null);
					if (!devices.has(devKey)) {
						devices.set(devKey, {
							id: devKey,
							name: dev.name || null,
							platform: devPlatform,
							fixture: suiteInfo.fixture || null,
							_suites: new Map()
						});
					}
					const device = devices.get(devKey);

					const suiteKey = suiteInfo.file || 'unknown';
					if (!device._suites.has(suiteKey)) {
						device._suites.set(suiteKey, {
							name: suiteInfo.suiteName,
							path: suiteInfo.suitePath,
							file: suiteInfo.file,
							retries: suiteInfo.retries,
							_configurations: new Map()
						});
					}
					const suite = device._suites.get(suiteKey);

					const configKey = `${suiteInfo.systemThread}|${suiteInfo.systemMode}`;
					if (!suite._configurations.has(configKey)) {
						suite._configurations.set(configKey, {
							systemThread: suiteInfo.systemThread,
							systemMode: suiteInfo.systemMode,
							_attempts: new Map()
						});
					}
					const config = suite._configurations.get(configKey);

					const attemptNum = runData.attempt || 1;
					if (!config._attempts.has(attemptNum)) {
						config._attempts.set(attemptNum, {
							attempt: attemptNum,
							passed: true,
							tests: []
						});
					}
					const attempt = config._attempts.get(attemptNum);

					const particle = test.particle || {};
					let duration = test.duration || 0;
					if (!duration && particle.startTime && particle.endTime) {
						duration = particle.endTime - particle.startTime;
					}
					const testData = {
						name: particle.originalTitle || test.title || test.name || '',
						duration,
						state: test.state || (test.pending ? 'skipped' : 'unknown')
					};
					if (test.err) {
						const err = { message: test.err.message || String(test.err) };
						if (test.err.stack) {
							err.stack = test.err.stack;
						}
						testData.err = err;
					}
					attempt.tests.push(testData);
					if (test.state !== 'passed' && test.state !== 'skipped') {
						attempt.passed = false;
					}
				}
			}
		}

		const devicesArray = Array.from(devices.values()).map(device => {
			const suites = Array.from(device._suites.values()).map(suite => {
				const configurations = Array.from(suite._configurations.values()).map(config => {
					const attempts = Array.from(config._attempts.values()).sort((a, b) => a.attempt - b.attempt);
					return {
						systemThread: config.systemThread,
						systemMode: config.systemMode,
						attempts
					};
				});
				return {
					name: suite.name,
					path: suite.path,
					file: suite.file,
					retries: suite.retries,
					configurations
				};
			});
			const result = {
				id: device.id,
				name: device.name,
				platform: device.platform,
				suites
			};
			if (device.fixture) {
				result.fixture = device.fixture;
			}
			return result;
		});

		return {
			version: 1,
			stats: {
				suites: suiteNames.size,
				tests: totalTests,
				passes: totalPasses,
				failures: totalFailures,
				skipped: totalSkipped,
				duration: totalDuration,
				start: startTime,
				end: endTime
			},
			devices: devicesArray
		};
	}

	_extractSuiteInfo(test) {
		let suite = test.parent;
		let file = null;
		let platformName = null;
		let systemThread = null;
		let systemMode = null;
		let fixtureName = null;
		let suiteName = null;
		let retries = 0;
		let fixtureObj = null;
		// Walk the parent chain to find the outermost suite (direct child of root)
		// That's the source suite whose title is the suite name for the report.
		let outermostSuite = null;
		while (suite) {
			if (!outermostSuite) {
				outermostSuite = suite;
			}
			if (suite.particle) {
				if (suite.particle.file) {
					file = suite.particle.file;
				}
				if (suite.particle.platform && !platformName) {
					platformName = suite.particle.platform.name;
				}
				if (suite.particle.systemThread && !systemThread) {
					systemThread = suite.particle.systemThread;
				}
				if (suite.particle.systemMode && !systemMode) {
					systemMode = suite.particle.systemMode;
				}
				if (suite.particle.fixtures && suite.particle.fixtures.length && !fixtureName) {
					fixtureObj = suite.particle.fixtures[0];
					fixtureName = fixtureObj.name;
				}
				if (suite.particle.suiteRetries !== undefined) {
					retries = suite.particle.suiteRetries;
				}
			}
			if (!suite.parent || !suite.parent.parent) {
				// suite is direct child of root (or root itself)
				outermostSuite = suite;
			}
			suite = suite.parent;
		}
		if (outermostSuite) {
			suiteName = outermostSuite.title;
		}
		if (test.particle && test.particle.suiteRetries !== undefined) {
			retries = test.particle.suiteRetries;
		}
		const suitePath = file ? path.dirname(file) : null;
		return { file, platform: platformName, systemThread, systemMode, fixture: fixtureName, suiteName: suiteName || '', suitePath, retries };
	}
}

module.exports = { ReportBuilder };
