#!/usr/bin/env python3
"""Package real ARM libraries and linker scripts for browser builds."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import runpy
import struct
import subprocess
import tempfile
import zipfile

assets = runpy.run_path(str(Path(__file__).with_name("install-vex-build-assets.py")))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--sdk", type=Path, required=True)
parser.add_argument("--rootfs", type=Path, required=True)
parser.add_argument("--output", type=Path, default=Path("apps/code/public/compiler"))
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)


def fix_vector_section(data):
    # PROS's assembly omits the AX flags on .freertos_vectors. GNU ld accepts
    # branches in this section; LLD requires the input section to be allocatable.
    # Change only section metadata, preserving all instructions and relocations.
    result = bytearray(data)
    if not data.startswith(b"!<arch>\n"):
        return data
    offset = 8
    while offset + 60 <= len(data):
        length = int(data[offset + 48 : offset + 58])
        start = offset + 60
        member = memoryview(result)[start : start + length]
        if member[:6] == b"\x7fELF\x01\x01":
            table = struct.unpack_from("<I", member, 32)[0]
            size, count, names_index = struct.unpack_from("<HHH", member, 46)
            names_header = table + size * names_index
            names_offset, names_size = struct.unpack_from(
                "<II", member, names_header + 16
            )
            names = bytes(member[names_offset : names_offset + names_size])
            for index in range(count):
                header = table + size * index
                name_offset = struct.unpack_from("<I", member, header)[0]
                name = names[name_offset:].split(b"\0", 1)[0]
                if name == b".freertos_vectors":
                    flags = struct.unpack_from("<I", member, header + 8)[0]
                    struct.pack_into("<I", member, header + 8, flags | 6)
        offset = start + length + (length % 2)
    return bytes(result)


def strip_debug(files):
    # Debug records dominate the SDK archives but do not affect uploaded code.
    with tempfile.TemporaryDirectory() as tmp:
        for name, data in list(files.items()):
            if not name.endswith(".a"):
                continue
            path = Path(tmp) / Path(name).name
            path.write_bytes(data)
            subprocess.run(
                ["arm-none-eabi-objcopy", "--strip-debug", str(path)], check=True
            )
            files[name] = path.read_bytes()
    return files


def write(name, files, provenance):
    provenance = {
        **provenance,
        "debugSections": "removed with arm-none-eabi-objcopy --strip-debug",
    }
    entries = []
    payload = bytearray()
    for path, data in files.items():
        digest = hashlib.sha256(hashlib.sha256(data).digest()).hexdigest()
        entries.append([path, len(payload), len(data), digest])
        payload.extend(data)
    index = json.dumps(entries, separators=(",", ":")).encode()
    raw = b"V5XSDK01" + struct.pack("<I", len(index)) + index + payload
    compressed = gzip.compress(raw, mtime=0)
    digest = hashlib.sha256(compressed).hexdigest()
    filename = f"{name}-{digest[:16]}.sdk.gz"
    (args.output / filename).write_bytes(compressed)
    return {
        "format": "indexed-v1",
        "url": f"/compiler/{filename}",
        "sha256": digest,
        "bytes": len(compressed),
        "provenance": provenance,
    }


sdk = args.sdk / "vexv5"
vex = {
    "/sdk/vexv5/" + name: (sdk / name).read_bytes()
    for name in [
        "lscript.ld",
        "stdlib_0.lib",
        "libv5rt.a",
        "license.pdf",
        "gcc/libs/libgcc.a",
        "gcc/libs/libstdc++.a",
        "gcc/libs/libc.a",
        "gcc/libs/libm.a",
    ]
}
language = json.loads(Path("apps/code/public/language/sdk-manifest.json").read_text())
version = language["gccVersion"]
arm = {
    "/toolchain/lib/"
    + name: (
        args.rootfs / "usr/arm-none-eabi/lib/thumb/v7+fp/softfp" / name
    ).read_bytes()
    for name in ["libstdc++.a"]
}
arm["/toolchain/lib/libgcc.a"] = (
    args.rootfs / f"usr/lib/gcc/arm-none-eabi/{version}/thumb/v7+fp/softfp/libgcc.a"
).read_bytes()
manifest = {
    "version": 2,
    "gccVersion": version,
    "templates": {
        "vexcode": ["vexcode"],
        "jar-template": ["vexcode"],
        "pros": ["arm", "pros"],
        "ez-template": ["arm", "pros", "ez-template"],
    },
    "bundles": {
        "vexcode": write("vexcode", strip_debug(vex), {"sdk": "vexv5"}),
        "arm": write(
            "arm",
            strip_debug(arm),
            {"gccVersion": version, "abi": "thumb/v7+fp/softfp"},
        ),
    },
}
shared_pros = {}
with tempfile.TemporaryDirectory() as tmp:
    for name, url, checksum in [
        ("pros", assets["PROS_KERNEL_URL"], assets["PROS_KERNEL_SHA256"]),
        ("ez-template", assets["EZ_TEMPLATE_URL"], assets["EZ_TEMPLATE_SHA256"]),
    ]:
        archive = Path(tmp) / (name + ".zip")
        assets["download_checked"](url, checksum, archive)
        with zipfile.ZipFile(archive) as bundle:
            files = {
                "/workspace/" + path: fix_vector_section(bundle.read(path))
                for path in bundle.namelist()
                if path.startswith("firmware/") and not path.endswith("/")
            }
        files = strip_debug(files)
        inherited = []
        if name == "pros":
            shared_pros = files.copy()
        else:
            inherited = [
                path for path, data in files.items() if shared_pros.get(path) == data
            ]
            files = {
                path: data for path, data in files.items() if path not in inherited
            }
        manifest["bundles"][name] = write(
            name,
            files,
            {
                "url": url,
                "archiveSha256": checksum,
                "lldCompatibility": ".freertos_vectors marked allocatable/executable",
                **(
                    {"inheritedBundle": "pros", "inheritedFiles": inherited}
                    if inherited
                    else {}
                ),
            },
        )
(args.output / "sdk-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
