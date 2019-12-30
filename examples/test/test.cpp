#include "test.h"

test(this_test_always_fails) {
    assertEqual(1, 2);
}

test(this_test_always_succeeds) {
    assertEqual(1, 1);
}
