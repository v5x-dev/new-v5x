/* SPDX-License-Identifier: GPL-2.0-or-later
 * Browser packet transport. QEMU owns one end; its parent JS worker owns the other.
 * Guest-to-host bytes are the kernel's semihosting stdout. Host-to-guest bytes are
 * written into the v5-uart chardev. Control and input are polled under the BQL,
 * so no QEMU API runs on a JS thread.
 */
#include "qemu/osdep.h"
#include <stdatomic.h>
#include <emscripten/emscripten.h>
#include <emscripten/threading.h>
#include "chardev/char.h"
#include "qemu/timer.h"
#include "system/runstate.h"

#define INPUT_SIZE 65536
#define OUTPUT_SIZE (4 * 1024 * 1024)
static struct {
    _Atomic uint32_t input_read, input_write, output_read, output_write;
    _Atomic uint32_t desired_pause, actual_pause, ready, error;
    uint8_t input[INPUT_SIZE];
    uint8_t output[OUTPUT_SIZE];
} bridge;
static Chardev *uart;
static QEMUTimer *poll_timer;

EMSCRIPTEN_KEEPALIVE void *v5_bridge(void) { return &bridge; }

static void v5_poll(void *opaque)
{
    uint32_t pause = atomic_load(&bridge.desired_pause);
    if (pause != atomic_load(&bridge.actual_pause)) {
        if (pause) {
            vm_stop(RUN_STATE_PAUSED);
        } else {
            vm_start();
        }
        atomic_store(&bridge.actual_pause, pause);
    }
    int available = qemu_chr_be_can_write(uart);
    uint32_t read = atomic_load(&bridge.input_read);
    uint32_t write = atomic_load(&bridge.input_write);
    while (available > 0 && read != write) {
        uint32_t pos = read % INPUT_SIZE;
        uint32_t count = MIN(MIN(write - read, INPUT_SIZE - pos), available);
        qemu_chr_be_write(uart, bridge.input + pos, count);
        read += count;
        atomic_store(&bridge.input_read, read);
        available = qemu_chr_be_can_write(uart);
    }
    atomic_store(&bridge.ready, 1);
    timer_mod(poll_timer, qemu_clock_get_ms(QEMU_CLOCK_REALTIME) + 2);
}

void v5_uart_open(Chardev *chr)
{
    uart = chr;
    poll_timer = timer_new_ms(QEMU_CLOCK_REALTIME, v5_poll, NULL);
    timer_mod(poll_timer, qemu_clock_get_ms(QEMU_CLOCK_REALTIME));
}

int v5_uart_write(const uint8_t *buf, int len)
{
    for (int i = 0; i < len; ) {
        uint32_t write = atomic_load(&bridge.output_write);
        uint32_t read = atomic_load(&bridge.output_read);
        if (write - read == OUTPUT_SIZE) {
            /* Backpressure preserves packet boundaries, even for full display buffers. */
            emscripten_thread_sleep(1);
            continue;
        }
        uint32_t pos = write % OUTPUT_SIZE;
        uint32_t count = MIN(MIN((uint32_t)(len - i), OUTPUT_SIZE - (write - read)), OUTPUT_SIZE - pos);
        memcpy(bridge.output + pos, buf + i, count);
        atomic_store(&bridge.output_write, write + count);
        i += count;
    }
    return len;
}
