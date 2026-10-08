#!/usr/bin/env bash
# Local alternative to QEMU's emsdk-wasm32-cross.docker. Requires an activated
# Emscripten 3.1.50 SDK, Meson 1.5, Ninja, pkg-config, autotools, git and curl.
set -euo pipefail
build_root=$(realpath "${1:?Usage: build-deps.sh BUILD_DIRECTORY}")
export TARGET="$build_root/deps"
export CPATH="$TARGET/include"
export PKG_CONFIG_PATH="$TARGET/lib/pkgconfig"
export EM_PKG_CONFIG_PATH="$PKG_CONFIG_PATH"
export PKG_CONFIG_LIBDIR="$PKG_CONFIG_PATH"
export CFLAGS='-O3 -pthread -DWASM_BIGINT'
export CXXFLAGS="$CFLAGS"
export LDFLAGS="-sWASM_BIGINT -sASYNCIFY=1 -L$TARGET/lib"
mkdir -p "$TARGET" "$build_root/deps-src"
cd "$build_root/deps-src"
cat > cross.meson <<EOF_CROSS
[host_machine]
system = 'emscripten'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'
[binaries]
c = 'emcc'
cpp = 'em++'
ar = 'emar'
ranlib = 'emranlib'
pkgconfig = ['pkg-config', '--static']
[built-in options]
c_args = ['-O3', '-pthread', '-DWASM_BIGINT', '-Wno-incompatible-function-pointer-types']
c_link_args = ['-sWASM_BIGINT', '-sASYNCIFY=1', '-L$TARGET/lib']
EOF_CROSS
cross_file="$PWD/cross.meson"
if [[ ! -f "$TARGET/lib/libz.a" ]]; then
    curl -Lf https://zlib.net/fossils/zlib-1.3.1.tar.gz | tar xz
    (cd zlib-1.3.1; emconfigure ./configure --prefix="$TARGET" --static; emmake make install -j4)
fi
if [[ ! -f "$TARGET/lib/libffi.a" ]]; then
    curl -Lf https://github.com/libffi/libffi/releases/download/v3.4.7/libffi-3.4.7.tar.gz | tar xz
    (cd libffi-3.4.7; emconfigure ./configure --host=wasm32-unknown-linux --prefix="$TARGET" --enable-static --disable-shared --disable-dependency-tracking --disable-builddir --disable-multi-os-directory --disable-raw-api --disable-docs; emmake make install SUBDIRS=include -j4)
fi
if [[ ! -f "$TARGET/lib/libpixman-1.a" ]]; then
    curl -Lf https://www.cairographics.org/releases/pixman-0.44.2.tar.gz | tar xz
    (cd pixman-0.44.2; meson setup _build --prefix="$TARGET" --cross-file="$cross_file" --default-library=static --buildtype=release -Dtests=disabled -Ddemos=disabled; meson install -C _build)
fi
if [[ ! -f "$TARGET/lib/libglib-2.0.a" ]]; then
    cat > res_query.c <<'EOF_C'
#include <netdb.h>
int res_query(const char *name, int class, int type, unsigned char *dest, int len) {
    h_errno = HOST_NOT_FOUND;
    return -1;
}
EOF_C
    emcc $CFLAGS -c res_query.c -fPIC -o libresolv.o
    emar rcs "$TARGET/lib/libresolv.a" libresolv.o
    curl -Lf https://download.gnome.org/sources/glib/2.84/glib-2.84.0.tar.xz | tar xJ
    (cd glib-2.84.0; meson setup _build --prefix="$TARGET" --cross-file="$cross_file" --default-library=static --buildtype=release --force-fallback-for=pcre2 -Dlibelf=disabled -Dselinux=disabled -Dxattr=false -Dlibmount=disabled -Dnls=disabled -Dtests=false -Dglib_debug=disabled -Dglib_assert=false -Dglib_checks=false; sed -i -E '/#define HAVE_POSIX_SPAWN 1/d; /#define HAVE_PTHREAD_GETNAME_NP 1/d' _build/config.h; meson install -C _build)
fi
