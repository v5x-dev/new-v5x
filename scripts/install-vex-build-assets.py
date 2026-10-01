#!/usr/bin/env python3
"""Install checksum-pinned PROS build assets into a VEX build image rootfs."""

import argparse
import hashlib
import os
import shutil
import stat
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

PROS_KERNEL_URL = (
    "https://pros.cs.purdue.edu/v5/_static/releases/kernel@3.8.3.zip"
)
PROS_KERNEL_SHA256 = (
    "fa0eddc8c9493ba1fca73ff7648227f8e84ec1784627f22e37a55445e5f2ecc8"
)
EZ_TEMPLATE_URL = (
    "https://github.com/EZ-Robotics/EZ-Template/releases/download/v3.2.2/"
    "EZ-Template-Example-Project.zip"
)
EZ_TEMPLATE_SHA256 = (
    "41ec47dc65588cf7efae84771965a4803611f5db88ed5465bbb829a5eb8d7822"
)
ASSET_ROOT = Path("opt/vex-build")


def download_checked(url: str, expected_sha256: str, destination: Path) -> None:
    request = urllib.request.Request(
        url, headers={"User-Agent": "v5x-vex-build-image"}
    )
    digest = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=120) as response:
        with destination.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                digest.update(chunk)
                output.write(chunk)
    actual_sha256 = digest.hexdigest()
    if actual_sha256 != expected_sha256:
        destination.unlink(missing_ok=True)
        raise ValueError(
            f"SHA-256 mismatch for {url}: expected {expected_sha256}, "
            f"got {actual_sha256}"
        )


def safe_extract(
    archive: Path,
    destination: Path,
    include_ez_template_files: bool = False,
) -> None:
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            relative = PurePosixPath(entry.filename)
            if (
                relative.is_absolute()
                or ".." in relative.parts
                or "\\" in entry.filename
                or (relative.parts and ":" in relative.parts[0])
            ):
                raise ValueError(f"Unsafe path in {archive.name}: {entry.filename}")

            if include_ez_template_files and not (
                relative == PurePosixPath("common.mk")
                or relative.parts[:1] in (("firmware",), ("include",))
            ):
                continue

            target = destination.joinpath(*relative.parts)
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue

            mode = (entry.external_attr >> 16) & 0xFFFF
            if stat.S_ISLNK(mode):
                raise ValueError(
                    f"Unexpected symlink in {archive.name}: {entry.filename}"
                )

            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(entry) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
            permissions = stat.S_IMODE(mode) & 0o777
            if permissions:
                os.chmod(target, permissions)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "rootfs",
        type=Path,
        help="Writable unpacked VEX build image rootfs",
    )
    args = parser.parse_args()
    rootfs = args.rootfs.resolve()
    required_files = (
        Path("usr/local/bin/clang"),
        Path("usr/bin/arm-none-eabi-gcc"),
        Path("usr/bin/arm-none-eabi-g++"),
    )
    missing = [
        str(path)
        for path in required_files
        if not (rootfs / path).is_file()
    ]
    if not rootfs.is_dir():
        parser.error(f"rootfs is not a directory: {rootfs}")
    if missing:
        parser.error(
            "rootfs is missing required build tools: " + ", ".join(missing)
        )

    asset_root = rootfs / ASSET_ROOT
    pros_destination = asset_root / "pros-kernel-3.8.3"
    ez_destination = asset_root / "ez-template-3.2.2"
    if pros_destination.exists() or ez_destination.exists():
        parser.error(f"build assets already exist under {asset_root}")

    with tempfile.TemporaryDirectory(prefix="vex-build-assets-") as temporary:
        temporary_root = Path(temporary)
        pros_archive = temporary_root / "pros-kernel-3.8.3.zip"
        ez_archive = temporary_root / "ez-template-3.2.2.zip"
        pros_staging = temporary_root / "pros"
        ez_staging = temporary_root / "ez-template"

        download_checked(PROS_KERNEL_URL, PROS_KERNEL_SHA256, pros_archive)
        download_checked(EZ_TEMPLATE_URL, EZ_TEMPLATE_SHA256, ez_archive)
        safe_extract(pros_archive, pros_staging)
        safe_extract(ez_archive, ez_staging, include_ez_template_files=True)

        asset_root.mkdir(parents=True, exist_ok=True)
        shutil.copytree(pros_staging, pros_destination)
        shutil.copytree(ez_staging, ez_destination)
        (asset_root / "MANIFEST").write_text(
            "PROS kernel 3.8.3\n"
            f"{PROS_KERNEL_SHA256}  {PROS_KERNEL_URL}\n"
            "EZ-Template example project 3.2.2\n"
            f"{EZ_TEMPLATE_SHA256}  {EZ_TEMPLATE_URL}\n",
            encoding="utf-8",
        )

    print(f"Installed pinned VEX build assets under {asset_root}")


if __name__ == "__main__":
    main()
