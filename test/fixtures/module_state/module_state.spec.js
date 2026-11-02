'use strict';
suite('module_state');

platform('boron');

let count = 0;

test('test_01', () => {
	count++;
	return count;
});
