FROM vex-v5-qemu-wasm-deps AS build
COPY qemu-10.1.0 /qemu
COPY overlay /overlay
RUN python3 /overlay/patch-qemu.py /qemu
WORKDIR /build
RUN emconfigure /qemu/configure --static --target-list=arm-softmmu \
    --without-default-features --enable-system --enable-tcg-interpreter \
    --disable-tools --disable-docs --disable-pie \
    --extra-cflags=-O3
RUN ninja -j4 qemu-system-arm.js
FROM scratch AS artifacts
COPY --from=build /build/qemu-system-arm.js /
COPY --from=build /build/qemu-system-arm.wasm /
COPY --from=build /build/qemu-system-arm.worker.js /
