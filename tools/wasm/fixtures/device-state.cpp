// Freestanding C++ acceptance program using the documented V5 SDK jump table.
// Connect a distance sensor to port 1 and a motor to port 2.
using u32 = unsigned int;

template <typename Function> Function sdk(u32 offset) {
  return reinterpret_cast<Function>(
      reinterpret_cast<volatile u32 *>(0x037fc000)[offset / 4]);
}

static void text(const char *value) {
  u32 length = 0;
  while (value[length])
    ++length;
  sdk<int (*)(u32, const char *, u32)>(0x89c)(1, value, length);
}

static void number(int value) {
  char buffer[12];
  unsigned magnitude = value < 0 ? -static_cast<unsigned>(value) : value;
  int length = 0;
  do {
    buffer[length++] = '0' + magnitude % 10;
    magnitude /= 10;
  } while (magnitude);
  if (value < 0)
    buffer[length++] = '-';
  while (length)
    sdk<int (*)(u32, unsigned char)>(0x898)(1, buffer[--length]);
}

extern "C" __attribute__((section(".text.start"))) void start() {
  void *motor = sdk<void *(*)(u32)>(0x19c)(1);
  sdk<void (*)(void *, int)>(0x2d0)(motor, 120);
  text("V5X_DEVICE motor_target=120\n");

  int previous[10] = {-1, -1, -1, -1, -1, -1, -1, -1, -1, -1};
  for (;;) {
    sdk<void (*)()>(0x05c)();
    void *device = sdk<void *(*)(u32)>(0x19c)(0);
    int values[10] = {
        static_cast<int>(sdk<u32 (*)(void *)>(0x500)(device)),
        sdk<int (*)()>(0xa00)(),
        sdk<int (*)()>(0xa04)(),
        static_cast<int>(sdk<double (*)()>(0xa08)()),
        static_cast<int>(sdk<double (*)()>(0xa0c)()),
        sdk<int (*)(u32, u32)>(0x1a4)(0, 2),  // Master Axis 1
        sdk<int (*)(u32, u32)>(0x1a4)(0, 3),  // Master Axis 2
        sdk<int (*)(u32, u32)>(0x1a4)(0, 6),  // Master L1
        sdk<int (*)(u32, u32)>(0x1a4)(0, 17), // Master A
        sdk<int (*)(u32, u32)>(0x1a4)(0, 22), // Master battery
    };
    bool changed = false;
    for (int i = 0; i < 10; ++i)
      if (values[i] != previous[i])
        changed = true;
    if (!changed)
      continue;
    text("V5X_DEVICE distance_mm=");
    number(values[0]);
    text(" voltage_mv=");
    number(values[1]);
    text(" current_ma=");
    number(values[2]);
    text(" temperature_c=");
    number(values[3]);
    text(" capacity_pct=");
    number(values[4]);
    text(" controller_axis1=");
    number(values[5]);
    text(" controller_axis2=");
    number(values[6]);
    text(" controller_l1=");
    number(values[7]);
    text(" controller_a=");
    number(values[8]);
    text(" controller_battery_pct=");
    number(values[9]);
    text("\n");
    for (int i = 0; i < 10; ++i)
      previous[i] = values[i];
  }
}
