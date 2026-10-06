#!/usr/bin/env python3
"""Copy a VEXcode rootfs and retain the ARM libraries used by V5 builds."""

import argparse
import shutil
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path)
parser.add_argument("destination", type=Path)
args = parser.parse_args()
if args.destination.exists():
    parser.error("destination must not exist")
if not (args.source / "usr/local/bin/clang").exists():
    parser.error("source must contain the custom VEX Clang")
library_paths = [
    Path("usr/arm-none-eabi/lib"),
    *(
        path.relative_to(args.source)
        for path in (args.source / "usr/lib/gcc/arm-none-eabi").iterdir()
    ),
]
for path in library_paths:
    if not (args.source / path / "thumb/v7+fp/softfp").is_dir():
        parser.error(f"source lacks the expected V5 multilib in {path}")
shutil.copytree(args.source, args.destination, symlinks=True)
root = args.destination


def remove(path):
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


# Remove native compiler files by APK ownership, preserving shared runtime libs.
database = (root / "lib/apk/db/installed").read_text()
for package in database.split("\n\n"):
    if "P:gcc\n" not in package:
        continue
    directory = ""
    for line in package.splitlines():
        if line.startswith("F:"):
            directory = line[2:]
        elif line.startswith("R:"):
            remove(root / directory / line[2:])

# PROS cortex-a9/neon-fp16/softfp selects thumb/v7+fp/softfp.
# Retain default libraries too: the backend checks default libstdc++.a.
for relative_path in library_paths:
    base = root / relative_path
    remove(base / "arm")
    thumb = base / "thumb"
    if thumb.exists():
        for variant in thumb.iterdir():
            if variant.name != "v7+fp":
                remove(variant)
        for abi in (thumb / "v7+fp").iterdir():
            if abi.name != "softfp":
                remove(abi)

for path in ["usr/share/man", "usr/share/doc", "usr/share/info", "var/cache/apk"]:
    remove(root / path)
print(f"Trimmed rootfs: {root}")
