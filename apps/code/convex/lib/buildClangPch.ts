// Enable this rule overlay only for the unchanged VEXcode/JAR build rules and
// umbrella headers. Custom configurations retain their own build behavior.
// Fingerprints cover makefile, vex/mkenv.mk, vex/mkrules.mk, include/vex.h,
// using the output of sha256sum in that order, including filenames.
const templateFingerprints = [
  '1850f94454dca555b51a855495006ed7d171b27fc5e61531d306df4c7c490e2d',
  'b408e6d23f9566f779bb5d7f1d0c197c47ad5d671845470ea22fbbf7b8b65fd0',
]

const rules = `
.DEFAULT_GOAL := all
V5X_PCH := $(BUILD)/.v5x-vex.pch

$(V5X_PCH): include/vex.h $(SRC_H) $(SRC_A) vex/mkenv.mk vex/mkrules.mk
\t@mkdir -p "$(@D)"
\t$(Q)$(CXX) $(CXX_FLAGS) $(INC) -x c++-header -MMD -MF $@.d -MT $@ -o $@ $<

-include $(V5X_PCH).d

$(OBJ): $(V5X_PCH)

$(BUILD)/%.o: %.cpp $(SRC_H) $(SRC_A)
\t$(Q)$(MKDIR)
\t$(ECHO) "CXX $<"
\t$(Q)if [ "$$(head -n 1 "$<" | tr -d '\\r')" = '#include "vex.h"' ]; then \\
\t  $(CXX) $(CXX_FLAGS) $(INC) -include-pch $(V5X_PCH) -c -o $@ $<; \\
\telse \\
\t  $(CXX) $(CXX_FLAGS) $(INC) -c -o $@ $<; \\
\tfi
`

export const prepareClangPch = [
  'build_makefile_args=""',
  'if [ -f makefile ] && [ -f vex/mkenv.mk ] && [ -f vex/mkrules.mk ] && [ -f include/vex.h ]; then',
  '  fingerprint="$(sha256sum makefile vex/mkenv.mk vex/mkrules.mk include/vex.h | sha256sum)"',
  '  fingerprint="${fingerprint%% *}"',
  `  case "$fingerprint" in ${templateFingerprints.join('|')})`,
  '    mkdir -p /tmp/v5x-build-cache',
  "    cat > /tmp/v5x-build-cache/clang-pch.mk <<'V5X_PCH_RULES'",
  rules,
  'V5X_PCH_RULES',
  '    build_makefile_args="-f makefile -f /tmp/v5x-build-cache/clang-pch.mk"',
  '  esac',
  'fi',
].join('\n')
