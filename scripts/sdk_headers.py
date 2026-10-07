"""Header selection for the supported V5 ARM configurations."""

from pathlib import PurePosixPath

OTHER_TARGET_HEADERS = {
    "altivec.h",
    "opencl-c.h",
    "opencl-c-base.h",
    "vecintrin.h",
    "msa.h",
}


def v5_builtin_header(path):
    name = PurePosixPath(path).name
    # These targets and host instrumentation runtimes cannot run on the V5.
    return not (
        name.endswith("intrin.h")
        or name.startswith("__clang_cuda_")
        or name in OTHER_TARGET_HEADERS
        or "/sanitizer/" in "/" + path
        or "/fuzzer/" in "/" + path
    )


def v5_cxx_header(path, configuration):
    marker = "/arm-none-eabi/"
    if marker not in path:
        return True
    relative = path.split(marker, 1)[1]
    # Keep shared target headers and the exact multilib selected by our flags.
    return relative.startswith(("bits/", "ext/", configuration + "/"))
