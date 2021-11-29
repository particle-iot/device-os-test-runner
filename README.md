# Device OS Test Runner

## Installation

Install with [npm](https://npmjs.com) globally:

```sh
npm install --global @particle/device-os-test-runner
```

device-os-test requires Node 12 to run.

## Getting Started

### Prerequisites

- Two Gen2 or Gen3 devices connected to the host computer via USB (the examples in this section use Borons).
- [Device OS source](https://github.com/particle-iot/device-os). Make sure the system firmware is compiled and flashed to the devices.
- [Particle CLI](https://github.com/particle-iot/particle-cli). Make sure you are logged in with your user account.

Source code of all examples can be found in the [examples](https://github.com/particle-iot/device-os-test/tree/master/examples) directory.

### Creating a Test Suite

device-os-test is based on the [Mocha](https://mochajs.org) testing framework. Test cases in Mocha are organized into test suites which are described in JavaScript spec files. By default, device-os-test looks for the spec files in the `user/tests/integration` directory.

Create a new directory and a spec file for the test suite:

```sh
cd $DEVICE_OS/user/tests/integration
mkdir test
nano test/test.spec.js # or use your favorite editor
```

Put the following into the `test.spec.js` file:

```js
suite('Test suite');

platform('gen2', 'gen3');
```

The above snippet defines a minimal suite configuration:

- `suite()` specifies the name of the test suite. device-os-test uses the Mocha's [QUnit](https://mochajs.org/#qunit) interface for its spec files.
- `platform()` specifies Device OS platforms supported by the suite. `gen2` and `gen3` in the above example are platform tags.

> Run `device-os-test list --tags` to get the list of recognized tags.

Let's add some Device OS tests:

```sh
nano test/test.cpp
```

In your editor:

```cpp
#include "test.h"

test(this_test_always_fails) {
    assertEqual(1, 2);
}

test(this_test_always_succeeds) {
    assertEqual(1, 1);
}
```

Device OS tests are implemented using the [ArduinoUnit](https://github.com/mmurdoch/arduinounit) library. Device OS has a port of that library which is available for use in test applications.

Run the tests using the following command:

```sh
device-os-test run test boron
```

> To diagnose errors, enable verbose logging by providing the runner with a `-v` argument in the command line.

`run` tells the device-os-test to start running tests. All other arguments following that command are interpreted as test filters. A filter can be a directory name or a tag. In the above command, `test` is the directory containing our test files and `boron` specifies the target platform. Filter arguments are optional and, if not specified, device-os-test will run all tests on all supported platforms.

When started, device-os-test will build test applications, flash the resulting binaries to the devices and start monitoring execution of the tests. When all tests are finished, it will print a summary report, which for the tests in this example should look as follows:

```
Test suite
  boron
    systemThread=disabled
      1) this_test_always_fails
      ✓ this_test_always_succeeds
    systemThread=enabled
      2) this_test_always_fails
      ✓ this_test_always_succeeds

2 passing (15s)
2 failing

1) Test suite
     boron
       systemThread=disabled
         this_test_always_fails:
   Assertion failed: (1=1) == (2=2), file tests/integration/test/test.cpp, line 4.

2) Test suite
     boron
       systemThread=enabled
         this_test_always_fails:
   Assertion failed: (1=1) == (2=2), file tests/integration/test/test.cpp, line 4.
```

As can be seen in the report, by default, device-os-test runs test cases in different Device OS threading modes. This can be overridden by specifying the desired threading mode explicitly in the spec file, for example:

```js
suite('Test suite');

platform('gen2', 'gen3');
systemThread('enabled');
```

### JavaScript Tests

A part of a test case can be implemented in JavaScript and executed on the host computer. This is useful when you need to verify some post-conditions of an on-device test which are difficult or impossible to verify within the application code.

Create a new test suite:

```sh
mkdir cloud_test
nano cloud_test/cloud_test.cpp
nano cloud_test/cloud_test.spec.js
```

cloud_test.cpp:

```cpp
#include "application.h"
#include "test.h"

test(particle_publish_publishes_an_event) {
    Particle.connect();
    waitUntil(Particle.connected);
    Particle.publish("my_event", "event data", PRIVATE);
}
```

cloud_test.spec.js:

```js
suite('Cloud tests');

platform('gen2', 'gen3');

test('Particle.publish() publishes an event', async function() {
  const value = await this.particle.receiveEvent('my_event');
  expect(value).to.equal('event data');
});
```

In this test, the Device OS application publishes a cloud event, the JavaScript code receives that event and verifies that it contains the expected data.

When running an on-device test, device-os-test checks if there is a JavaScript test which has a name that matches the name of the on-device test. If there is such a test, device-os-test will run it immediately after the on-device test finishes its execution.

> In Mocha, a test name can be an arbitrary string, while ArduinoUnit requires it to be a valid identifier name. When matching names of JavaScript and C++ test cases, device-os-test normalizes the name of the JavaScript test by replacing its non-identifier characters with underscores.

Note that the `receiveEvent()` function which is used in this example is experimental and will likely be moved to a separate module in future versions of device-os-test. You can access a preconfigured instance of the [particle-api-js](https://docs.particle.io/reference/SDKs/javascript) client directly in your tests:

```js
test('Calling a cloud function', async function() {
  const api = this.particle.apiClient;
  const device = this.particle.devices[0];
  await api.instance.callFunction({
    deviceId: device.id,
    name: 'myFunction',
    token: api.token
  });
});
```

### Test Fixtures

A test can involve multiple devices where each device has a specific role or require a specific wiring. Such configurations are called test fixtures.

In order to be a part of a test fixture, a device needs to be assigned an alias. Aliases are used in test cases instead of the real device IDs or names. The mapping between aliases and local devices is specified in a configuration file.

For example, a configuration file for the [I2C test](https://github.com/particle-iot/device-os-test/tree/master/examples/i2c_test) may look as follows:

```json
{
  "fixtures": [
    {
      "name": "i2c_master",
      "devices": [
        "boron1"
      ]
    },
    {
      "name": "i2c_slave",
      "devices": [
        "boron2"
      ]
    }
  ]
}
```

Here, `boron1` and `boron2` are the names of the devices which are expected to act as the I2C master and slave devices respectively. The test suite refers to those devices via their aliases:

```js
suite('I2C test');

platform('gen2', 'gen3');

fixture('i2c_slave', 'i2c_master');
```

The test suite has two Device OS applications: [i2c_master](https://github.com/particle-iot/device-os-test/tree/master/examples/i2c_test/i2c_master) and [i2c_slave](https://github.com/particle-iot/device-os-test/tree/master/examples/i2c_test/i2c_slave). By default, if the name of an application directory matches the name of a device's alias, the application will be flashed to that device.

The order in which test cases on both devices are executed depends on their names (ArduinoUnit sorts test cases by name) and, if the test names on both devices match, on the order in which the aliases of the devices are passed to the `fixture()` function in the spec file. For the I2C test, it is important to start the slave device first, hence why its alias comes before the alias of the master device in the list of `fixture()` arguments.

## Contributing to this tool

### Get the linter/tests working

Git clone + cd into cloned directory, then:

1. `nvm use`; use right version of node
1. `npm install`; get depenencies
1. `npm test`; watch the linter + tests run
1. Add code and test coverage as you go