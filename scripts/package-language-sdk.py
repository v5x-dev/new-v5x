#!/usr/bin/env python3
"""Package the exact build image headers for browser clangd; never invent SDK stubs."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import runpy
from sdk_headers import v5_builtin_header, v5_cxx_header

assets = runpy.run_path(str(Path(__file__).with_name("install-vex-build-assets.py")))
download_checked = assets["download_checked"]
PROS_KERNEL_URL = assets["PROS_KERNEL_URL"]
PROS_KERNEL_SHA256 = assets["PROS_KERNEL_SHA256"]
EZ_TEMPLATE_URL = assets["EZ_TEMPLATE_URL"]
EZ_TEMPLATE_SHA256 = assets["EZ_TEMPLATE_SHA256"]
import tempfile
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--sdk", type=Path, required=True, help="VEX SDK directory containing vexv5"
)
parser.add_argument(
    "--rootfs",
    type=Path,
    required=True,
    help="Build image rootfs containing ARM toolchain headers",
)
parser.add_argument("--output", type=Path, default=Path("apps/code/public/language"))
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)


def directory(source, target):
    if not source.is_dir():
        raise ValueError(f"Missing header directory: {source}")
    return {
        str(Path(target) / p.relative_to(source)): p.read_text(errors="strict")
        for p in sorted(source.rglob("*"))
        if p.is_file()
    }


def write(name, files, provenance):
    raw = json.dumps({"files": files}, separators=(",", ":")).encode()
    compressed = gzip.compress(raw, mtime=0)
    digest = hashlib.sha256(compressed).hexdigest()
    filename = f"{name}-{digest[:16]}.bundle"
    (args.output / filename).write_bytes(compressed)
    return {
        "url": f"/language/{filename}",
        "sha256": digest,
        "bytes": len(compressed),
        "provenance": provenance,
    }


vex = {}
for name in ["include", "gcc/include"]:
    vex.update(directory(args.sdk / "vexv5" / name, "/sdk/vexv5/" + name))
vex = {
    path: contents
    for path, contents in vex.items()
    if v5_cxx_header(path, "armv7-ar/thumb")
}
clang = {
    path: contents
    for path, contents in directory(
        args.sdk / "vexv5/clang/8.0.0/include", "/sdk/vexv5/clang/8.0.0/include"
    ).items()
    if v5_builtin_header(path)
}
versions = sorted((args.rootfs / "usr/arm-none-eabi/include/c++").iterdir())
version = versions[-1].name
arm = {
    path: contents
    for path, contents in directory(
        args.rootfs / "usr/arm-none-eabi/include", "/toolchain/include"
    ).items()
    if v5_cxx_header(path, "thumb/v7+fp/softfp")
}
# GCC 16's hidden friend return type eagerly accesses an incomplete iterator in
# clang 15. declval expresses the same pointer subtraction without that access.
iterator_path = f"/toolchain/include/c++/{version}/bits/stl_iterator.h"
needle = "operator-(const __normal_iterator& __lhs,\n\t\t  const __normal_iterator<_Iter, _Container>& __rhs) noexcept\n\t-> decltype(__lhs.base() - __rhs.base())"
replacement = "operator-(const __normal_iterator& __lhs,\n\t\t  const __normal_iterator<_Iter, _Container>& __rhs) noexcept\n\t-> decltype(std::declval<_Iterator>() - std::declval<_Iter>())"
arm[iterator_path] = arm[iterator_path].replace(needle, replacement)
manifest = {
    "version": 2,
    "gccVersion": version,
    "templates": {
        "vexcode": ["clang", "vexcode"],
        "jar-template": ["clang", "vexcode"],
        "pros": ["clang", "arm", "pros"],
        "ez-template": ["clang", "arm", "pros", "ez-template"],
    },
    "bundles": {
        "clang": write(
            "clang",
            clang,
            {
                "clangHeaders": "8.0.0",
                "target": "V5 ARM; host and other target headers omitted",
            },
        ),
        "vexcode": write(
            "vexcode",
            vex,
            {"sdk": "vexv5", "gccHeaders": "4.9.3", "abi": "armv7-ar/thumb"},
        ),
        "arm": write(
            "arm",
            arm,
            {
                "gccHeaders": version,
                "source": "VEX build image",
                "compatibility": "clang15 normal_iterator hidden friend return type uses equivalent declval expression",
            },
        ),
    },
}
with tempfile.TemporaryDirectory() as tmp:
    for name, url, checksum in [
        ("pros", PROS_KERNEL_URL, PROS_KERNEL_SHA256),
        ("ez-template", EZ_TEMPLATE_URL, EZ_TEMPLATE_SHA256),
    ]:
        archive = Path(tmp) / (name + ".zip")
        download_checked(url, checksum, archive)
        with zipfile.ZipFile(archive) as z:
            headers = {
                "/workspace/" + p: z.read(p).decode()
                for p in z.namelist()
                if p.startswith("include/") and not p.endswith("/")
            }
        manifest["bundles"][name] = write(
            name, headers, {"url": url, "archiveSha256": checksum}
        )
(args.output / "sdk-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
