import { api, internal } from './_generated/api'
import { action, internalMutation, mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { store } from './store'
import type { Doc, Id } from './_generated/dataModel'
import boring from 'boring-name-generator'

export const createProgram = action({
  args: {
    name: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<'program'>> => {
    const identity = await ctx.auth.getUserIdentity()

    if (!identity) {
      throw new Error('Unauthorized')
    }

    const repo = await store.createRepo({
      id: boring({ words: 3, number: true }).dashed,
      defaultBranch: 'main',
    })

    await repo
      .createCommit({
        targetBranch: repo.defaultBranch,
        commitMessage: 'Initialize template',
        author: { name: 'v5x', email: 'beanarchyteam@gmail.com' },
      })
      .addFileFromString(
        'include/vex.h',
        '#include <math.h>\r\n#include <stdio.h>\r\n#include <stdlib.h>\r\n#include <string.h>\r\n\r\n#include "v5.h"\r\n#include "v5_vcs.h"\r\n\r\n\r\n#define waitUntil(condition)                                                   \\\r\n  do {                                                                         \\\r\n    wait(5, msec);                                                             \\\r\n  } while (!(condition))\r\n\r\n#define repeat(iterations)                                                     \\\r\n  for (int iterator = 0; iterator < iterations; iterator++)',
      )
      .addFileFromString(
        'src/main.cpp',
        '#include "vex.h"\r\n\r\nusing namespace vex;\r\n\r\ncompetition Competition;\r\n\r\nvoid pre_auton(void) {}\r\n\r\nvoid autonomous(void) {}\r\n\r\nvoid usercontrol(void) {\r\n  while (1) {\r\n    wait(20, msec); \r\n  }\r\n}\r\n\r\nint main() {\r\n  Competition.autonomous(autonomous);\r\n  Competition.drivercontrol(usercontrol);\r\n\r\n  pre_auton();\r\n\r\n  while (true) {\r\n    wait(100, msec);\r\n  }\r\n}',
      )
      .addFileFromString(
        'vex/mkenv.mk',
        '# VEXcode mkenv.mk 2022_06_26_01\r\n\r\n# macros to help with paths that include spaces\r\nsp = $() $()\r\nqs = $(subst ?, ,$1)\r\nsq = $(subst $(sp),?,$1)\r\n\r\n# default platform and build location\r\nPLATFORM  = vexv5\r\nBUILD     = build\r\n\r\n# version for clang headers\r\nifneq ("$(origin HEADERS)", "command line")\r\nHEADERS = 8.0.0\r\nendif\r\n\r\n# Project name passed from app\r\nifeq ("$(origin P)", "command line")\r\nPROJECT  := $(P)\r\nelse\r\nPROJECT  := $(call qs,$(notdir $(call sq,${CURDIR})))\r\nendif\r\n\r\n# check if the PROJECT name contains any whitespace\r\nifneq (1,$(words $(PROJECT)))\r\n$(error Project name cannot contain whitespace: $(PROJECT))\r\nendif\r\n\r\n# SDK path passed from app\r\n# if not set then environmental variabled used\r\nifeq ("$(origin T)", "command line")\r\nVEX_SDK_PATH = $(T)\r\nendif\r\n# backup if still not set\r\nVEX_SDK_PATH ?= ${HOME}/sdk\r\n\r\n# printf_float flag name passed from app (not used in this version)\r\nifeq ("$(origin PRINTF_FLOAT)", "command line")\r\nPRINTF_FLAG = -u_printf_float\r\nendif\r\n\r\n# Verbose flag passed from app\r\nifeq ("$(origin V)", "command line")\r\nBUILD_VERBOSE=$(V)\r\nendif\r\n\r\n# allow verbose to be set by makefile if not set by app\r\nifndef VERBOSE\r\nBUILD_VERBOSE ?= 0\r\nelse\r\nBUILD_VERBOSE ?= $(VERBOSE)\r\nendif\r\n\r\n# use verbose flag\r\nifeq ($(BUILD_VERBOSE),0)\r\nQ = @\r\nelse\r\nQ =\r\nendif\r\n\r\n# compile and link tools\r\nCC      = clang\r\nCXX     = clang\r\nOBJCOPY = arm-none-eabi-objcopy\r\nSIZE    = arm-none-eabi-size\r\nLINK    = arm-none-eabi-ld\r\nARCH    = arm-none-eabi-ar\r\nECHO    = @echo\r\nDEFINES = -DVexV5\r\n\r\n# platform specific macros\r\nifeq ($(OS),Windows_NT)\r\n$(info windows build for platform $(PLATFORM))\r\nSHELL = cmd.exe\r\nMKDIR = md "$(@D)" 2> nul || :\r\nRMDIR = rmdir /S /Q\r\nCLEAN = $(RMDIR) $(BUILD) 2> nul || :\r\nelse\r\n# which flavor of linux\r\nUNAME := $(shell sh -c \'uname -sm 2>/dev/null || Unknown\')\r\n$(info unix build for platform $(PLATFORM) on $(UNAME))\r\nMKDIR = mkdir -p "$(@D)" 2> /dev/null || :\r\nRMDIR = rm -rf\r\nCLEAN = $(RMDIR) $(BUILD) 2> /dev/null || :\r\nendif\r\n\r\n# toolchain include and lib locations\r\nTOOL_INC  = -I"$(VEX_SDK_PATH)/$(PLATFORM)/clang/$(HEADERS)/include" -I"$(VEX_SDK_PATH)/$(PLATFORM)/gcc/include/c++/4.9.3"  -I"$(VEX_SDK_PATH)/$(PLATFORM)/gcc/include/c++/4.9.3/arm-none-eabi/armv7-ar/thumb" -I"$(VEX_SDK_PATH)/$(PLATFORM)/gcc/include"\r\nTOOL_LIB  = -L"$(VEX_SDK_PATH)/$(PLATFORM)/gcc/libs"\r\n\r\n# compiler flags\r\nCFLAGS_CL = -target thumbv7-none-eabi -fshort-enums -Wno-unknown-attributes -U__INT32_TYPE__ -U__UINT32_TYPE__ -D__INT32_TYPE__=long -D__UINT32_TYPE__=\'unsigned long\' \r\nCFLAGS_V7 = -march=armv7-a -mfpu=neon -mfloat-abi=softfp\r\nCFLAGS    = ${CFLAGS_CL} ${CFLAGS_V7} -Os -Wall -Werror=return-type -ansi -std=gnu99 $(DEFINES)\r\nCXX_FLAGS = ${CFLAGS_CL} ${CFLAGS_V7} -Os -Wall -Werror=return-type -fno-rtti -fno-threadsafe-statics -fno-exceptions  -std=gnu++11 -ffunction-sections -fdata-sections $(DEFINES)\r\n\r\n# linker flags\r\nLNK_FLAGS = -nostdlib -T "$(VEX_SDK_PATH)/$(PLATFORM)/lscript.ld" -R "$(VEX_SDK_PATH)/$(PLATFORM)/stdlib_0.lib" -Map="$(BUILD)/$(PROJECT).map" --gc-section -L"$(VEX_SDK_PATH)/$(PLATFORM)" ${TOOL_LIB}\r\n\r\n# future statuc library\r\nPROJECTLIB = lib$(PROJECT)\r\nARCH_FLAGS = rcs\r\n\r\n# libraries\r\nLIBS =  --start-group -lv5rt -lstdc++ -lc -lm -lgcc --end-group\r\n\r\n# include file paths\r\nINC += $(addprefix -I, ${INC_F})\r\nINC += -I"$(VEX_SDK_PATH)/$(PLATFORM)/include"\r\nINC += ${TOOL_INC}',
      )
      .addFileFromString(
        'vex/mkrules.mk',
        '# VEXcode mkrules.mk 2019_03_26_01\r\n\r\n# compile C files\r\n$(BUILD)/%.o: %.c $(SRC_H)\r\n\t$(Q)$(MKDIR)\r\n\t$(ECHO) "CC  $<"\r\n\t$(Q)$(CC) $(CFLAGS) $(INC) -c -o $@ $<\r\n\t\r\n# compile C++ files\r\n$(BUILD)/%.o: %.cpp $(SRC_H) $(SRC_A)\r\n\t$(Q)$(MKDIR)\r\n\t$(ECHO) "CXX $<"\r\n\t$(Q)$(CXX) $(CXX_FLAGS) $(INC) -c -o $@ $<\r\n\t\r\n# create executable \r\n$(BUILD)/$(PROJECT).elf: $(OBJ)\r\n\t$(ECHO) "LINK $@"\r\n\t$(Q)$(LINK) $(LNK_FLAGS) -o $@ $^ $(LIBS)\r\n\t$(Q)$(SIZE) $@\r\n\r\n# create binary \r\n$(BUILD)/$(PROJECT).bin: $(BUILD)/$(PROJECT).elf\r\n\t$(Q)$(OBJCOPY) -O binary $(BUILD)/$(PROJECT).elf $(BUILD)/$(PROJECT).bin\r\n\r\n# create archive\r\n$(BUILD)/$(PROJECTLIB).a: $(OBJ)\r\n\t$(Q)$(ARCH) $(ARCH_FLAGS) $@ $^\r\n\r\n# clean project\r\nclean:\r\n\t$(info clean project)\r\n\t$(Q)$(CLEAN)',
      )
      .addFileFromString(
        'makefile',
        '# VEXcode makefile 2019_03_26_01\r\n\r\n# show compiler output\r\nVERBOSE = 0\r\n\r\n# include toolchain options\r\ninclude vex/mkenv.mk\r\n\r\n# location of the project source cpp and c files\r\nSRC_C  = $(wildcard src/*.cpp) \r\nSRC_C += $(wildcard src/*.c)\r\nSRC_C += $(wildcard src/*/*.cpp) \r\nSRC_C += $(wildcard src/*/*.c)\r\n\r\nOBJ = $(addprefix $(BUILD)/, $(addsuffix .o, $(basename $(SRC_C))) )\r\n\r\n# location of include files that c and cpp files depend on\r\nSRC_H  = $(wildcard include/*.h)\r\n\r\n# additional dependancies\r\nSRC_A  = makefile\r\n\r\n# project header file locations\r\nINC_F  = include\r\n\r\n# build targets\r\nall: $(BUILD)/$(PROJECT).bin\r\n\r\n# include build rules\r\ninclude vex/mkrules.mk',
      )
      .addFileFromString(
        '.gitignore',
        '/bin\r\n/build\r\ncompile_commands.json',
      )
      .send()

    return await ctx.runMutation(api.program.create, {
      name: args.name || repo.id,
      repoId: repo.id,
    })
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    repoId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()

    if (!identity) {
      throw new Error('Unauthorized')
    }

    return await ctx.db.insert('program', {
      name: args.name,
      ownerId: identity.subject,
      repoId: args.repoId,
    })
  },
})

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()

    if (!identity) {
      throw new Error('Unauthorized')
    }

    return await ctx.db
      .query('program')
      .withIndex('by_owner', (q) => q.eq('ownerId', identity.subject))
      .collect()
  },
})

export const get = query({
  args: { programId: v.id('program') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()

    if (!identity) {
      throw new Error('Unauthorized')
    }

    const program = await ctx.db.get('program', args.programId)

    if (program?.ownerId !== identity.subject) {
      throw new Error('Unauthorized to view this program')
    }

    return program
  },
})

export const getSession = query({
  args: { programId: v.id('program') },
  handler: async (ctx, args): Promise<Doc<'programSession'> | null> => {
    const identity = await ctx.auth.getUserIdentity()

    if (!identity) {
      throw new Error('Unauthorized')
    }

    const program = await ctx.db.get('program', args.programId)

    if (program?.ownerId !== identity.subject) {
      throw new Error('Unauthorized to view this program')
    }

    return await ctx.db
      .query('programSession')
      .withIndex('by_program', (q) => q.eq('programId', args.programId))
      .first()
  },
})

export const ensureSession = action({
  args: { programId: v.id('program') },
  handler: async (ctx, args): Promise<Doc<'programSession'>> => {
    const identity = await ctx.auth.getUserIdentity()

    if (!identity) {
      throw new Error('Unauthorized')
    }

    const existingSession = await ctx.runQuery(api.program.getSession, {
      programId: args.programId,
    })

    if (existingSession) {
      return existingSession
    }

    const program = await ctx.runQuery(api.program.get, {
      programId: args.programId,
    })
    const repo = await store.findOne({ id: program.repoId })

    if (!repo) {
      throw new Error('Repo not found')
    }

    const branch = `session/${args.programId}`
    const branches = await repo.listBranches({ ephemeral: true, limit: 100 })
    const existingBranch = branches.branches.find(
      (item) => item.name === branch,
    )

    let headSha = existingBranch?.headSha
    let baseSha: string | undefined

    if (!headSha) {
      const createdBranch = await repo.createBranch({
        baseRef: repo.defaultBranch,
        targetBranch: branch,
        targetIsEphemeral: true,
      })

      if (!createdBranch.commitSha) {
        throw new Error('Session branch has no base commit')
      }

      headSha = createdBranch.commitSha
      baseSha = createdBranch.commitSha
    }

    return await ctx.runMutation(internal.program.createSession, {
      programId: args.programId,
      ownerId: identity.subject,
      branch,
      headSha,
      baseSha,
    })
  },
})

export const createSession = internalMutation({
  args: {
    programId: v.id('program'),
    ownerId: v.string(),
    branch: v.string(),
    headSha: v.string(),
    baseSha: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<'programSession'>> => {
    const existingSession = await ctx.db
      .query('programSession')
      .withIndex('by_program', (q) => q.eq('programId', args.programId))
      .first()

    if (existingSession) {
      return existingSession
    }

    const sessionId = await ctx.db.insert('programSession', {
      ...args,
      updatedAt: Date.now(),
    })

    const session = await ctx.db.get('programSession', sessionId)

    if (!session) {
      throw new Error('Failed to create program session')
    }

    return session
  },
})

export const advanceSession = internalMutation({
  args: {
    programId: v.id('program'),
    expectedHeadSha: v.string(),
    headSha: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    const session = await ctx.db
      .query('programSession')
      .withIndex('by_program', (q) => q.eq('programId', args.programId))
      .first()

    if (!session) {
      throw new Error('Program session not found')
    }

    if (session.headSha !== args.expectedHeadSha) {
      throw new Error('Program session changed elsewhere')
    }

    await ctx.db.patch(session._id, {
      headSha: args.headSha,
      updatedAt: Date.now(),
    })

    return args.headSha
  },
})

export const saveFile = action({
  args: {
    programId: v.id('program'),
    path: v.string(),
    contents: v.string(),
    headSha: v.string(),
  },
  handler: async (ctx, args): Promise<{ headSha: string }> => {
    const identity = await ctx.auth.getUserIdentity()

    if (!identity) {
      throw new Error('Unauthorized')
    }

    const program = await ctx.runQuery(api.program.get, {
      programId: args.programId,
    })
    const session = await ctx.runQuery(api.program.getSession, {
      programId: args.programId,
    })

    if (!session) {
      throw new Error('Program session not found')
    }

    if (session.headSha !== args.headSha) {
      throw new Error('Program session changed elsewhere')
    }

    const repo = await store.findOne({ id: program.repoId })

    if (!repo) {
      throw new Error('Repo not found')
    }

    const snapshot = await repo
      .createCommit({
        targetBranch: session.branch,
        commitMessage: `Update ${args.path}`,
        author: {
          name: identity.name ?? 'v5x',
          email: identity.email ?? 'beanarchyteam@gmail.com',
        },
        expectedHeadSha: session.headSha,
        ephemeral: true,
      })
      .addFileFromString(args.path, args.contents)
      .send()

    await ctx.runMutation(internal.program.advanceSession, {
      programId: args.programId,
      expectedHeadSha: session.headSha,
      headSha: snapshot.commitSha,
    })

    return { headSha: snapshot.commitSha }
  },
})

export const listFiles = action({
  args: { programId: v.id('program'), headSha: v.string() },
  handler: async (ctx, args) => {
    const program = await ctx.runQuery(api.program.get, {
      programId: args.programId,
    })

    const repo = await store.findOne({ id: program.repoId })

    if (!repo) {
      throw new Error('Repo not found')
    }

    return await repo.listFiles({ ref: args.headSha, ephemeral: true })
  },
})

export const readFile = action({
  args: {
    programId: v.id('program'),
    path: v.string(),
    headSha: v.string(),
  },
  handler: async (ctx, args) => {
    const program = await ctx.runQuery(api.program.get, {
      programId: args.programId,
    })

    const repo = await store.findOne({ id: program.repoId })

    if (!repo) {
      throw new Error('Repo not found')
    }

    const res = await repo.getFileStream({
      path: args.path,
      ref: args.headSha,
      ephemeral: true,
    })
    return await res.text()
  },
})

export const build = action({
  args: { programId: v.id('program'), headSha: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.runQuery(api.program.getSession, {
      programId: args.programId,
    })

    if (!session) {
      throw new Error('Program session not found')
    }

    if (session.headSha !== args.headSha) {
      throw new Error('Program changed before the build started')
    }

    const program = await ctx.runQuery(api.program.get, {
      programId: args.programId,
    })

    const repo = await store.findOne({ id: program.repoId })

    if (!repo) {
      throw new Error('Repo not found')
    }

    const ephemeralRef = `refs/namespaces/ephemeral/refs/heads/${session.branch}`

    const remoteUrl = await repo.getEphemeralRemoteURL({
      permissions: ['git:read'],
      ttl: 600,
      refPolicies: [
        { pattern: ephemeralRef },
        { pattern: '*', ops: ['no-push'] },
      ],
    })

    const result = await fetch(`${process.env.SMOL_CLOUD_URL!}/v1/machines`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SMOL_CLOUD_TOKEN!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `${repo.id}-builder`,
        source: { type: 'image', reference: 'debian:latest' },
        resources: { cpus: 2, memoryMb: 1024 },
        network: { mode: 'open' },
      }),
    })

    const machine = await result.json()

    console.log(machine)

    try {
      const result = await fetch(
        `${process.env.SMOL_CLOUD_URL!}/v1/machines/${machine.id}/exec`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.SMOL_CLOUD_TOKEN!}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            command: ['git', '--help'],
          }),
        },
      )

      console.log(await result.json())
    } finally {
      await fetch(
        `${process.env.SMOL_CLOUD_URL!}/v1/machines/${machine.id}/stop`,
        {
          method: 'POST',
        },
      )

      await fetch(
        `${process.env.SMOL_CLOUD_URL!}/v1/machines/${machine.id}/delete`,
        {
          method: 'DELETE',
        },
      )
    }
  },
})
