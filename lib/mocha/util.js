export function rootSuiteFromContext(ctx) {
	if (!ctx.test) {
		throw new Error('Invalid context object');
	}
	let suite = ctx.test.parent;
	while (suite) {
		if (suite.root) {
			break;
		}
		suite = suite.parent;
	}
	if (!suite) {
		throw new Error('Unable to get root suite');
	}
	return suite;
}
