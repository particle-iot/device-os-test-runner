#include "application.h"
#include "test.h"

namespace {

const char* const MASTER_MESSAGE = "hello slave";
const char* const SLAVE_MESSAGE = "hello master";
const uint8_t SLAVE_ADDRESS = 0x01;
const unsigned TIMEOUT = 5000;

char buffer[I2C_BUFFER_LENGTH] = {};
volatile bool received = false;
volatile bool sent = false;

void onReceive(int) {
    size_t size = 0;
    while (Wire.available() > 0 && size < sizeof(buffer) - 1) {
        buffer[size++] = Wire.read();
    }
    buffer[size] = '\0';
    received = true;
}

void onRequest() {
    Wire.write((const uint8_t*)SLAVE_MESSAGE, strlen(SLAVE_MESSAGE));
    sent = true;
}

bool waitFlag(volatile bool& flag) {
    const auto timeStarted = millis();
    while (!flag) {
        delay(100);
        if (millis() - timeStarted >= TIMEOUT) {
            return false;
        }
    }
    return true;
}

STARTUP({
    // Initialize I2C slave
    Wire.onReceive(onReceive);
    Wire.onRequest(onRequest);
    Wire.begin(SLAVE_ADDRESS);
})

} // namespace

test(master_can_send_and_slave_can_receive_data) {
    assertTrue(waitFlag(received));
    assertEqual(strcmp(buffer, MASTER_MESSAGE), 0);
}

test(slave_can_send_and_master_can_receive_data) {
    assertTrue(waitFlag(sent));
}
