import type { Repo } from "@pierre/storage"
import { ezTemplateFiles } from "./ezTemplate"

export type ProgramTemplate = "vexcode" | "pros" | "ez-template"

const vexcodeTemplateFiles: Record<string, string> = {
  ".gitignore": "/bin\n/build\ncompile_commands.json\n",
  "include/vex.h": "#include <math.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n\n#include \"v5.h\"\n#include \"v5_vcs.h\"\n\n\n#define waitUntil(condition)                                                   \\\n  do {                                                                         \\\n    wait(5, msec);                                                             \\\n  } while (!(condition))\n\n#define repeat(iterations)                                                     \\\n  for (int iterator = 0; iterator < iterations; iterator++)",
  "makefile": "# VEXcode makefile 2019_03_26_01\n\n# show compiler output\nVERBOSE = 0\n\n# include toolchain options\ninclude vex/mkenv.mk\n\n# location of the project source cpp and c files\nSRC_C  = $(wildcard src/*.cpp) \nSRC_C += $(wildcard src/*.c)\nSRC_C += $(wildcard src/*/*.cpp) \nSRC_C += $(wildcard src/*/*.c)\n\nOBJ = $(addprefix $(BUILD)/, $(addsuffix .o, $(basename $(SRC_C))) )\n\n# location of include files that c and cpp files depend on\nSRC_H  = $(wildcard include/*.h)\n\n# additional dependancies\nSRC_A  = makefile\n\n# project header file locations\nINC_F  = include\n\n# build targets\nall: $(BUILD)/$(PROJECT).bin\n\n# include build rules\ninclude vex/mkrules.mk\n",
  "src/main.cpp": "#include \"vex.h\"\r\n\r\nusing namespace vex;\r\n\r\ncompetition Competition;\r\n\r\nvoid pre_auton(void) {}\r\n\r\nvoid autonomous(void) {}\r\n\r\nvoid usercontrol(void) {\r\n  while (1) {\r\n    wait(20, msec);\r\n  }\r\n}\r\n\r\nint main() {\r\n  Competition.autonomous(autonomous);\r\n  Competition.drivercontrol(usercontrol);\r\n\r\n  pre_auton();\r\n\r\n  while (true) {\r\n    wait(100, msec);\r\n  }\r\n}\r\n",
  "vex/mkenv.mk": "# VEXcode mkenv.mk 2022_06_26_01\n\n# macros to help with paths that include spaces\nsp = $() $()\nqs = $(subst ?, ,$1)\nsq = $(subst $(sp),?,$1)\n\n# default platform and build location\nPLATFORM  = vexv5\nBUILD     = build\n\n# version for clang headers\nifneq (\"$(origin HEADERS)\", \"command line\")\nHEADERS = 8.0.0\nendif\n\n# Project name passed from app\nifeq (\"$(origin P)\", \"command line\")\nPROJECT  := $(P)\nelse\nPROJECT  := $(call qs,$(notdir $(call sq,${CURDIR})))\nendif\n\n# check if the PROJECT name contains any whitespace\nifneq (1,$(words $(PROJECT)))\n$(error Project name cannot contain whitespace: $(PROJECT))\nendif\n\n# SDK path passed from app\n# if not set then environmental variabled used\nifeq (\"$(origin T)\", \"command line\")\nVEX_SDK_PATH = $(T)\nendif\n# backup if still not set\nVEX_SDK_PATH ?= ${HOME}/sdk\n\n# printf_float flag name passed from app (not used in this version)\nifeq (\"$(origin PRINTF_FLOAT)\", \"command line\")\nPRINTF_FLAG = -u_printf_float\nendif\n\n# Verbose flag passed from app\nifeq (\"$(origin V)\", \"command line\")\nBUILD_VERBOSE=$(V)\nendif\n\n# allow verbose to be set by makefile if not set by app\nifndef VERBOSE\nBUILD_VERBOSE ?= 0\nelse\nBUILD_VERBOSE ?= $(VERBOSE)\nendif\n\n# use verbose flag\nifeq ($(BUILD_VERBOSE),0)\nQ = @\nelse\nQ =\nendif\n\n# compile and link tools\nCC      = clang\nCXX     = clang\nOBJCOPY = arm-none-eabi-objcopy\nSIZE    = arm-none-eabi-size\nLINK    = arm-none-eabi-ld\nARCH    = arm-none-eabi-ar\nECHO    = @echo\nDEFINES = -DVexV5\n\n# platform specific macros\nifeq ($(OS),Windows_NT)\n$(info windows build for platform $(PLATFORM))\nSHELL = cmd.exe\nMKDIR = md \"$(@D)\" 2> nul || :\nRMDIR = rmdir /S /Q\nCLEAN = $(RMDIR) $(BUILD) 2> nul || :\nelse\n# which flavor of linux\nUNAME := $(shell sh -c 'uname -sm 2>/dev/null || Unknown')\n$(info unix build for platform $(PLATFORM) on $(UNAME))\nMKDIR = mkdir -p \"$(@D)\" 2> /dev/null || :\nRMDIR = rm -rf\nCLEAN = $(RMDIR) $(BUILD) 2> /dev/null || :\nendif\n\n# toolchain include and lib locations\nTOOL_INC  = -I\"$(VEX_SDK_PATH)/$(PLATFORM)/clang/$(HEADERS)/include\" -I\"$(VEX_SDK_PATH)/$(PLATFORM)/gcc/include/c++/4.9.3\"  -I\"$(VEX_SDK_PATH)/$(PLATFORM)/gcc/include/c++/4.9.3/arm-none-eabi/armv7-ar/thumb\" -I\"$(VEX_SDK_PATH)/$(PLATFORM)/gcc/include\"\nTOOL_LIB  = -L\"$(VEX_SDK_PATH)/$(PLATFORM)/gcc/libs\"\n\n# compiler flags\nCFLAGS_CL = -target thumbv7-none-eabi -fshort-enums -Wno-unknown-attributes -U__INT32_TYPE__ -U__UINT32_TYPE__ -D__INT32_TYPE__=long -D__UINT32_TYPE__='unsigned long' \nCFLAGS_V7 = -march=armv7-a -mfpu=neon -mfloat-abi=softfp\nCFLAGS    = ${CFLAGS_CL} ${CFLAGS_V7} -Os -Wall -Werror=return-type -ansi -std=gnu99 $(DEFINES)\nCXX_FLAGS = ${CFLAGS_CL} ${CFLAGS_V7} -Os -Wall -Werror=return-type -fno-rtti -fno-threadsafe-statics -fno-exceptions  -std=gnu++11 -ffunction-sections -fdata-sections $(DEFINES)\n\n# linker flags\nLNK_FLAGS = -nostdlib -T \"$(VEX_SDK_PATH)/$(PLATFORM)/lscript.ld\" -R \"$(VEX_SDK_PATH)/$(PLATFORM)/stdlib_0.lib\" -Map=\"$(BUILD)/$(PROJECT).map\" --gc-section -L\"$(VEX_SDK_PATH)/$(PLATFORM)\" ${TOOL_LIB}\n\n# future statuc library\nPROJECTLIB = lib$(PROJECT)\nARCH_FLAGS = rcs\n\n# libraries\nLIBS =  --start-group -lv5rt -lstdc++ -lc -lm -lgcc --end-group\n\n# include file paths\nINC += $(addprefix -I, ${INC_F})\nINC += -I\"$(VEX_SDK_PATH)/$(PLATFORM)/include\"\nINC += ${TOOL_INC}\n",
  "vex/mkrules.mk": "# VEXcode mkrules.mk 2019_03_26_01\n\n# compile C files\n$(BUILD)/%.o: %.c $(SRC_H)\n\t$(Q)$(MKDIR)\n\t$(ECHO) \"CC  $<\"\n\t$(Q)$(CC) $(CFLAGS) $(INC) -c -o $@ $<\n\t\n# compile C++ files\n$(BUILD)/%.o: %.cpp $(SRC_H) $(SRC_A)\n\t$(Q)$(MKDIR)\n\t$(ECHO) \"CXX $<\"\n\t$(Q)$(CXX) $(CXX_FLAGS) $(INC) -c -o $@ $<\n\t\n# create executable \n$(BUILD)/$(PROJECT).elf: $(OBJ)\n\t$(ECHO) \"LINK $@\"\n\t$(Q)$(LINK) $(LNK_FLAGS) -o $@ $^ $(LIBS)\n\t$(Q)$(SIZE) $@\n\n# create binary \n$(BUILD)/$(PROJECT).bin: $(BUILD)/$(PROJECT).elf\n\t$(Q)$(OBJCOPY) -O binary $(BUILD)/$(PROJECT).elf $(BUILD)/$(PROJECT).bin\n\n# create archive\n$(BUILD)/$(PROJECTLIB).a: $(OBJ)\n\t$(Q)$(ARCH) $(ARCH_FLAGS) $@ $^\n\n# clean project\nclean:\n\t$(info clean project)\n\t$(Q)$(CLEAN)\n"
};

const prosTemplateFiles: Record<string, string> = {
  ".gitignore": "*.o\n*.obj\n*.bin\n*.elf\nbin/\n.d/\n.vscode/\n.cache/\ncompile_commands.json\ntemp.log\ntemp.errors\n*.ini\n",
  "Makefile": "CEXTS:=c\nASMEXTS:=s S\nCXXEXTS:=cpp c++ cc\n\nROOT=.\nFWDIR:=$(ROOT)/firmware\nBINDIR=$(ROOT)/bin\nSRCDIR=$(ROOT)/src\nINCDIR=$(ROOT)/include\n\nWARNFLAGS+=\nEXTRA_CFLAGS=\nEXTRA_CXXFLAGS=\n\nUSE_PACKAGE:=1\nEXCLUDE_COLD_LIBRARIES:=\nIS_LIBRARY:=0\n.DEFAULT_GOAL=quick\n-include ./common.mk\n",
  "project.pros": "{\n  \"target\": \"v5\",\n  \"templates\": {},\n  \"upload_options\": {},\n  \"project_name\": \"pros-project\"\n}\n",
  "include/main.h": "#ifndef _PROS_MAIN_H_\n#define _PROS_MAIN_H_\n\n#define PROS_USE_SIMPLE_NAMES\n#define PROS_USE_LITERALS\n\n#include \"api.h\"\n\n#ifdef __cplusplus\nextern \"C\" {\n#endif\nvoid autonomous(void);\nvoid initialize(void);\nvoid disabled(void);\nvoid competition_initialize(void);\nvoid opcontrol(void);\n#ifdef __cplusplus\n}\n#endif\n\n#endif  // _PROS_MAIN_H_\n",
  "src/main.cpp": "#include \"main.h\"\n\nvoid initialize() {}\n\nvoid disabled() {}\n\nvoid competition_initialize() {}\n\nvoid autonomous() {}\n\nvoid opcontrol() {\n  while (true) {\n    pros::delay(20);\n  }\n}\n",
}

export async function initializeTemplate(
  repo: Repo,
  template: ProgramTemplate,
  author: { name: string; email: string },
) {
  const files =
    template === "ez-template"
      ? ezTemplateFiles
      : template === "pros"
        ? prosTemplateFiles
        : vexcodeTemplateFiles
  const commit = repo.createCommit({
    targetBranch: repo.defaultBranch,
    commitMessage:
      template === "ez-template"
        ? "Initialize EZ-Template project"
        : template === "pros"
          ? "Initialize PROS competition template"
          : "Initialize C++ competition template",
    author,
  });

  for (const [path, contents] of Object.entries(files)) {
    commit.addFileFromString(path, contents);
  }

  return await commit.send();
}
