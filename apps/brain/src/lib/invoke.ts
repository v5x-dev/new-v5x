interface QemuOptions {
  gdb: boolean
  qemu: string
  kernel: string
  binary: string
  qemu_args: string[]
}

export function spawnQemu(_opts: QemuOptions) {}

export function killQemu() {}
