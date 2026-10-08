#!/usr/bin/env python3
"""Apply the small browser transport overlay to the pinned QEMU 10.1 source."""
from pathlib import Path
import shutil
import sys

source = Path(sys.argv[1])
overlay = Path(__file__).resolve().parent

def replace(path, old, new):
    text = path.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Expected QEMU 10.1 text missing in {path}: {old}")
    path.write_text(text.replace(old, new, 1))

shutil.copyfile(overlay / 'v5-bridge.c', source / 'chardev/v5-bridge.c')
replace(source / 'chardev/meson.build', "  'char-ringbuf.c',", "  'char-ringbuf.c',\n  'v5-bridge.c',")
replace(source / 'chardev/char-ringbuf.c', '/* Ring buffer chardev */',
        'void v5_uart_open(Chardev *chr);\nint v5_uart_write(const uint8_t *buf, int len);\n\n/* Ring buffer chardev */')
replace(source / 'chardev/char-ringbuf.c', '    for (i = 0; i < len; i++) {',
        '    if (!strcmp(chr->label, "v5-uart")) {\n        return v5_uart_write(buf, len);\n    }\n\n    for (i = 0; i < len; i++) {')
replace(source / 'chardev/char-ringbuf.c', '    d->cbuf = g_malloc0(d->size);',
        '    d->cbuf = g_malloc0(d->size);\n    if (!strcmp(chr->label, "v5-uart")) {\n        v5_uart_open(chr);\n    }')
# The kernel writes host-bound packets with semihosting stdout, which the native
# host reads from QEMU's stdout pipe. Emscripten's stdout is text-only.
replace(source / 'semihosting/syscalls.c',
        '    ret = write(gf->hostfd, ptr, len);\n    unlock_user(ptr, buf, 0);\n    complete(cs, ret, ret == -1 ? errno : 0);',
        '''#ifdef EMSCRIPTEN
    if (gf->hostfd == STDOUT_FILENO) {
        extern int v5_uart_write(const uint8_t *buf, int len);
        ret = v5_uart_write(ptr, len);
        unlock_user(ptr, buf, 0);
        complete(cs, ret, 0);
        return;
    }
#endif
    ret = write(gf->hostfd, ptr, len);
    unlock_user(ptr, buf, 0);
    complete(cs, ret, ret == -1 ? errno : 0);''')
replace(source / 'configure', '  echo "strip = [$(meson_quote $strip)]" >> $cross',
        '  echo "strip = [$(meson_quote $strip)]" >> $cross\n  echo "exe_wrapper = [\'node\']" >> $cross')
# An ES module factory lets each session own and dispose of its pthreads.
flags = source / 'configs/meson/emscripten.txt'
text = flags.read_text().replace("'-sTOTAL_MEMORY=2GB'", "'-sINITIAL_MEMORY=512MB','-sALLOW_MEMORY_GROWTH=1','-sMAXIMUM_MEMORY=2GB'")
text = text.replace("'-sEXPORT_ES6=1',", "")
text = text.replace('addFunction,removeFunction,TTY,FS', 'addFunction,removeFunction,TTY,FS,PThread')
flags.write_text(text)

# Configure probes must be plain runnable scripts; only the emulator is an ES module.
replace(source / 'meson.build', "    emulator = executable(exe_name, exe['sources'],",
        "    if host_os == 'emscripten'\n      link_args += ['-sEXPORT_ES6=1', '-sMODULARIZE=1', '-sEXPORT_NAME=createQemu', '-sEXIT_RUNTIME=1']\n    endif\n    emulator = executable(exe_name, exe['sources'],")
