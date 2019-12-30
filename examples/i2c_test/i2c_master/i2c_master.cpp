#include "application.h"
#include "test.h"

namespace {

const char* const MASTER_MESSAGE = "hello slave";
const char* const SLAVE_MESSAGE = "hello master";
const uint8_t SLAVE_ADDRESS = 0x01;

STARTUP({
    // Initialize I2C master
    Wire.begin();
})

} // namespace

test(master_can_send_and_slave_can_receive_data) {
    Wire.beginTransmission(SLAVE_ADDRESS);
    Wire.write((const uint8_t*)MASTER_MESSAGE, strlen(MASTER_MESSAGE));
    assertEqual(Wire.endTransmission(), 0);
}

test(slave_can_send_and_master_can_receive_data) {
    char buffer[I2C_BUFFER_LENGTH] = {};
    assertMore(Wire.requestFrom(SLAVE_ADDRESS, sizeof(buffer)), 0);
    size_t size = 0;
    while (Wire.available() > 0 && size < sizeof(buffer) - 1) {
        buffer[size++] = Wire.read();
    }
    buffer[size] = '\0';
    assertEqual(strcmp(buffer, SLAVE_MESSAGE), 0);
}
