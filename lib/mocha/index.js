import { Suite, parsePlatformTags } from '../suite';

import { Suite as MochaSuite } from 'mocha';
import clone from 'clone';
import chai from 'chai';

global.expect = chai.expect;

global.platforms = function(...tags) {
	before(function() {
		if (!this.currentTest) {
			throw new Error('platforms() is called outside of a test suite');
		}
		const currentSuite = this.currentTest.parent;
		const parentSuite = currentSuite.parent;
	});
}
