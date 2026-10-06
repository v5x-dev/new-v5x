const PROS_KERNEL_URL =
  'https://pros.cs.purdue.edu/v5/_static/releases/kernel@3.8.3.zip'

const PROS_KERNEL_SHA256 =
  'fa0eddc8c9493ba1fca73ff7648227f8e84ec1784627f22e37a55445e5f2ecc8'

const PROS_KERNEL_ARCHIVE = '/tmp/pros-kernel-3.8.3.zip'

const PROS_KERNEL_IMAGE_DIR = '/opt/vex-build/pros-kernel-3.8.3'

const PROS_KERNEL_READY_MARKER = '/tmp/v5x-build-cache/pros-kernel-3.8.3.ready'

const EZ_TEMPLATE_PROJECT_URL =
  'https://github.com/EZ-Robotics/EZ-Template/releases/download/v3.2.2/EZ-Template-Example-Project.zip'

const EZ_TEMPLATE_PROJECT_SHA256 =
  '41ec47dc65588cf7efae84771965a4803611f5db88ed5465bbb829a5eb8d7822'

const EZ_TEMPLATE_PROJECT_ARCHIVE = '/tmp/ez-template-example-project-3.2.2.zip'

const EZ_TEMPLATE_IMAGE_DIR = '/opt/vex-build/ez-template-3.2.2'

const prepareProsBuild = [
  'set -eu',
  'command -v arm-none-eabi-gcc >/dev/null 2>&1 || { echo "PROS image is missing arm-none-eabi-gcc." >&2; exit 127; }',
  'command -v arm-none-eabi-g++ >/dev/null 2>&1 || { echo "PROS image is missing arm-none-eabi-g++." >&2; exit 127; }',
  'stdlib_path=$(arm-none-eabi-g++ -print-file-name=libstdc++.a)',
  '[ -f "$stdlib_path" ] || { echo "PROS image is missing the ARM C++ standard library." >&2; exit 127; }',
  `if [ -f '${PROS_KERNEL_READY_MARKER}' ] && [ -f '/workspace/common.mk' ] && [ -f '/workspace/firmware/libpros.a' ] && [ -f '/workspace/include/api.h' ]; then`,
  '  :',
  `elif [ -d '${PROS_KERNEL_IMAGE_DIR}' ]; then`,
  `  cp -a -n '${PROS_KERNEL_IMAGE_DIR}/.' '/workspace/'`,
  '  mkdir -p /tmp/v5x-build-cache',
  `  touch '${PROS_KERNEL_READY_MARKER}'`,
  'else',
  '  command -v wget >/dev/null 2>&1 || { echo "Build image is missing wget and the baked PROS kernel." >&2; exit 127; }',
  '  command -v unzip >/dev/null 2>&1 || { echo "Build image is missing unzip." >&2; exit 127; }',
  '  command -v sha256sum >/dev/null 2>&1 || { echo "Build image is missing sha256sum." >&2; exit 127; }',
  `  wget -q -O '${PROS_KERNEL_ARCHIVE}' '${PROS_KERNEL_URL}'`,
  `  printf '%s  %s\\n' '${PROS_KERNEL_SHA256}' '${PROS_KERNEL_ARCHIVE}' | sha256sum --check -`,
  `  unzip -n -q '${PROS_KERNEL_ARCHIVE}' -d '/workspace'`,
  '  mkdir -p /tmp/v5x-build-cache',
  `  touch '${PROS_KERNEL_READY_MARKER}'`,
  'fi',
].join('\n')

const prepareEzTemplateBuild = [
  'set -eu',
  'command -v arm-none-eabi-gcc >/dev/null 2>&1 || { echo "PROS image is missing arm-none-eabi-gcc." >&2; exit 127; }',
  'command -v arm-none-eabi-g++ >/dev/null 2>&1 || { echo "PROS image is missing arm-none-eabi-g++." >&2; exit 127; }',
  'stdlib_path=$(arm-none-eabi-g++ -print-file-name=libstdc++.a)',
  '[ -f "$stdlib_path" ] || { echo "PROS image is missing the ARM C++ standard library." >&2; exit 127; }',
  `if [ "$(cat '/workspace/.ez-template' 2>/dev/null || true)" = '3.2.2' ] && [ -f '/workspace/common.mk' ] && [ -f '/workspace/firmware/EZ-Template.a' ] && [ -f '/workspace/include/EZ-Template/api.hpp' ]; then`,
  '  :',
  `elif [ -d '${EZ_TEMPLATE_IMAGE_DIR}' ]; then`,
  `  cp -a -n '${EZ_TEMPLATE_IMAGE_DIR}/.' '/workspace/'`,
  'else',
  '  command -v wget >/dev/null 2>&1 || { echo "Build image is missing wget and the baked EZ Template files." >&2; exit 127; }',
  '  command -v unzip >/dev/null 2>&1 || { echo "Build image is missing unzip." >&2; exit 127; }',
  '  command -v sha256sum >/dev/null 2>&1 || { echo "Build image is missing sha256sum." >&2; exit 127; }',
  `  wget -q -O '${EZ_TEMPLATE_PROJECT_ARCHIVE}' '${EZ_TEMPLATE_PROJECT_URL}'`,
  `  printf '%s  %s\\n' '${EZ_TEMPLATE_PROJECT_SHA256}' '${EZ_TEMPLATE_PROJECT_ARCHIVE}' | sha256sum --check -`,
  `  unzip -n -q '${EZ_TEMPLATE_PROJECT_ARCHIVE}' 'common.mk' 'firmware/*' 'include/*' -d '/workspace'`,
  'fi',
].join('\n')

const prosHeaderFlags = [
  '-iquote./include',
  '-iquote./include/./',
  '-mcpu=cortex-a9',
  '-mfpu=neon-fp16',
  '-mfloat-abi=softfp',
  '-Os',
  '-g',
  '-D_POSIX_THREADS',
  '-D_UNIX98_THREAD_MUTEX_ATTRIBUTES',
  '-D_POSIX_TIMERS',
  '-D_POSIX_MONOTONIC_CLOCK',
  '-Wno-psabi',
  '-ffunction-sections',
  '-fdata-sections',
  '-fdiagnostics-color',
  '-funwind-tables',
  '--std=gnu++17',
].join(' ')

const ezHeaderFlags = [
  '-iquote./include',
  '-iquote./include/okapi/squiggles',
  '-iquote./include/./',
  '-mcpu=cortex-a9',
  '-mfpu=neon-fp16',
  '-mfloat-abi=softfp',
  '-Os',
  '-g',
  '-D_POSIX_THREADS',
  '-D_UNIX98_THREAD_MUTEX_ATTRIBUTES',
  '-D_POSIX_TIMERS',
  '-D_POSIX_MONOTONIC_CLOCK',
  '-D_PROS_INCLUDE_LIBLVGL_LLEMU_H',
  '-D_PROS_INCLUDE_LIBLVGL_LLEMU_HPP',
  '-Wno-psabi',
  '-ffunction-sections',
  '-fdata-sections',
  '-fdiagnostics-color',
  '-funwind-tables',
  '--std=gnu++20',
  '-Wno-deprecated-enum-enum-conversion',
].join(' ')

// main.h pulls in the PROS headers. Compiling it once per machine keeps an
// edit from parsing those headers again. Flags match common.mk.
export const preparePrecompiledHeader = [
  'if [ -f project.pros ] && [ -f include/main.h ]; then',
  '  if [ -f include/main.h.gch ]; then',
  "    stale=\"$(find include -type f \\( -name '*.h' -o -name '*.hpp' \\) -newer include/main.h.gch -print -quit 2>/dev/null || true)\"",
  '    if [ -n "$stale" ]; then rm -f include/main.h.gch; fi',
  '  fi',
  '  if [ ! -f include/main.h.gch ]; then',
  '    if [ -f .ez-template ]; then',
  `      arm-none-eabi-g++ -c ${ezHeaderFlags} -x c++-header include/main.h -o include/main.h.gch`,
  '    else',
  `      arm-none-eabi-g++ -c ${prosHeaderFlags} -x c++-header include/main.h -o include/main.h.gch`,
  '    fi',
  '  fi',
  'fi',
].join('\n')

export const prepareBuildSdk = [
  'set -eu',
  'if [ -f project.pros ]; then',
  '  if [ -f .ez-template ]; then',
  prepareEzTemplateBuild,
  '  else',
  prepareProsBuild,
  '  fi',
  'fi',
].join('\n')
