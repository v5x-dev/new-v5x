import { expect, test } from "bun:test";
import { generateProsColdLibraryName } from "./pros-cold-hash";

test("matches PROS generate_cold_hash for kernel+liblvgl", () => {
  expect(generateProsColdLibraryName(["kernel", "liblvgl"])).toBe(
    "ud6cW0YGTEQCrxk6G2DBsQ",
  );
});
