export type Framework = "vexcode" | "pros" | "ez"

export type ProgramTemplateFile = {
  path: string
  content: string
  isReadonly?: boolean
}

const VEXCODE_MAIN = `#include "vex.h"

using namespace vex;

competition Competition;

void pre_auton(void) {
  vexcodeInit();
}

void autonomous(void) {}

void usercontrol(void) {
  while (true) {
    wait(20, msec);
  }
}

int main() {
  Competition.autonomous(autonomous);
  Competition.drivercontrol(usercontrol);

  pre_auton();

  while (true) {
    wait(100, msec);
  }
}
`

const PROS_MAIN = `#include "main.h"

void initialize() {}

void disabled() {}

void competition_initialize() {}

void autonomous() {}

void opcontrol() {
  pros::Controller master(pros::E_CONTROLLER_MASTER);

  while (true) {
    // Add driver controls here.
    pros::delay(20);
  }
}
`

const PROS_HEADER = `#ifndef _PROS_MAIN_H_
#define _PROS_MAIN_H_

#define PROS_USE_SIMPLE_NAMES
#define PROS_USE_LITERALS

#include "api.h"

#ifdef __cplusplus
extern "C" {
#endif

void autonomous(void);
void initialize(void);
void disabled(void);
void competition_initialize(void);
void opcontrol(void);

#ifdef __cplusplus
}
#endif

#endif  // _PROS_MAIN_H_
`

const PROS_MAKEFILE = `# PROS project Makefile

.DEFAULT_GOAL=quick

include common.mk
`

const PROS_PROJECT = `{
  "py/object": "pros.conductor.project.Project",
  "py/state": {
    "project_name": "v5x-program",
    "target": "v5",
    "templates": {}
  }
}
`

const EZ_MAIN = `#include "main.h"

ez::Drive chassis(
    {1, 2, 3},
    {-4, -5, -6},
    7,
    4.125,
    343);

void initialize() {
  ez::ez_template_print();
  pros::delay(500);

  default_constants();
  ez::as::auton_selector.autons_add({
      {"Drive forward", drive_forward},
  });

  chassis.initialize();
  ez::as::initialize();
}

void disabled() {}

void competition_initialize() {}

void autonomous() {
  chassis.pid_targets_reset();
  chassis.drive_imu_reset();
  chassis.drive_sensor_reset();
  chassis.odom_xyt_set(0_in, 0_in, 0_deg);
  chassis.drive_brake_set(MOTOR_BRAKE_HOLD);
  ez::as::auton_selector.selected_auton_call();
}

void opcontrol() {
  chassis.drive_brake_set(MOTOR_BRAKE_COAST);

  while (true) {
    chassis.opcontrol_tank();
    pros::delay(ez::util::DELAY_TIME);
  }
}
`

const EZ_AUTONS = `#include "main.h"

const int DRIVE_SPEED = 110;

void default_constants() {
  chassis.pid_drive_constants_set(20.0, 0.0, 100.0);
  chassis.pid_heading_constants_set(11.0, 0.0, 20.0);
  chassis.pid_turn_constants_set(3.0, 0.05, 20.0, 15.0);
  chassis.pid_drive_exit_condition_set(
      90_ms, 1_in, 250_ms, 3_in, 500_ms, 500_ms);
}

void drive_forward() {
  chassis.pid_drive_set(24_in, DRIVE_SPEED, true);
  chassis.pid_wait();
}
`

export const PROGRAM_TEMPLATES: Record<
  Framework,
  readonly ProgramTemplateFile[]
> = {
  vexcode: [
    {
      path: "include/robot-config.h",
      content: `#pragma once

using namespace vex;

extern brain Brain;

void vexcodeInit(void);
`,
    },
    {
      path: "include/vex.h",
      isReadonly: true,
      content: `#pragma once

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "v5.h"
#include "v5_vcs.h"
#include "robot-config.h"
`,
    },
    { path: "src/main.cpp", content: VEXCODE_MAIN },
    {
      path: "src/robot-config.cpp",
      content: `#include "vex.h"

using namespace vex;

brain Brain;

void vexcodeInit(void) {}
`,
    },
  ],
  pros: [
    { path: "include/main.h", content: PROS_HEADER },
    { path: "src/main.cpp", content: PROS_MAIN },
    { path: "Makefile", content: PROS_MAKEFILE, isReadonly: true },
    { path: "project.pros", content: PROS_PROJECT, isReadonly: true },
  ],
  ez: [
    {
      path: "include/autons.hpp",
      content: `#pragma once

void default_constants();
void drive_forward();
`,
    },
    {
      path: "include/main.h",
      content: PROS_HEADER.replace(
        '#include "api.h"',
        '#include "api.h"\n#include "EZ-Template/api.hpp"\n#include "autons.hpp"\n#include "subsystems.hpp"\n\nusing namespace okapi::literals;'
      ),
    },
    {
      path: "include/subsystems.hpp",
      content: `#pragma once

#include "EZ-Template/api.hpp"
#include "api.h"

extern ez::Drive chassis;

// Declare motors, sensors, and other subsystems here.
`,
    },
    { path: "src/autons.cpp", content: EZ_AUTONS },
    { path: "src/main.cpp", content: EZ_MAIN },
    { path: "Makefile", content: PROS_MAKEFILE, isReadonly: true },
    { path: "project.pros", content: PROS_PROJECT, isReadonly: true },
  ],
}
