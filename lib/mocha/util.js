export function currentTest(ctx) {
	if (!ctx.currentTest) {
		throw new Error('Unable to get current test')
	}
	return ctx.currentTest;
}

export function currentHook(ctx) {
	if (!ctx.test) {
		throw new Error('Unable to get current hook')
	}
	return ctx.test;
}

export function parentObject(obj) {
	if (!obj.parent) {
		throw new Error('Unable to get parent object')
	}
	return obj.parent;
}

export function rootSuite(obj) {
	let suite = obj;
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
