ENTRY(start)
SECTIONS {
  . = 0x03800000;
  .text : {
    LONG(0x35585658) LONG(0) LONG(2) LONG(0)
    . = 0x20;
    KEEP(*(.text.start))
    *(.text*) *(.rodata*)
  }
  .data : { *(.data*) }
  .bss : { *(.bss*) *(COMMON) }
  /DISCARD/ : { *(.ARM.exidx*) *(.ARM.extab*) }
}
