#!/usr/bin/env bash
set -euo pipefail
fixture_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
fixture_output=${1:-/tmp/v5x-device-state}
arm-none-eabi-g++ -mcpu=cortex-a9 -marm -mfloat-abi=softfp -mfpu=vfpv3 \
  -Os -ffreestanding -fno-exceptions -fno-rtti -fno-unwind-tables \
  -fno-asynchronous-unwind-tables -nostdlib \
  -Wl,-T,"$fixture_dir/device-state.ld" "$fixture_dir/device-state.cpp" \
  -lgcc -o "$fixture_output.elf"
arm-none-eabi-objcopy -O binary "$fixture_output.elf" "$fixture_output.bin"
