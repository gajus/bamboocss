#!/bin/sh
# Builds the extractor into bamboo-native-extractor.node.
#
#   sh scripts/build.sh [--release] [--target <triple>]
#
# `--target` builds for Linux with cargo-zigbuild, as the release workflow does. A gnu triple names
# the glibc to link against, as `x86_64-unknown-linux-gnu.2.17` does, so the binary does not need
# the newer one on the machine that built it; a musl triple builds for Alpine.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

if command -v cargo >/dev/null 2>&1; then
  cargo_bin=cargo
elif [ -x "$HOME/.cargo/bin/cargo" ]; then
  cargo_bin="$HOME/.cargo/bin/cargo"
else
  echo 'Rust is required to build @bamboocss/native-extractor.' >&2
  exit 1
fi

profile=debug
target=
while [ $# -gt 0 ]; do
  case "$1" in
    --release) profile=release ;;
    --target) target=$2; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

flags=--locked
if [ "$profile" = release ]; then
  flags="$flags --release"
fi

if [ -n "$target" ]; then
  # The glibc suffix is cargo-zigbuild's; rustup and the target directory know the triple alone.
  triple=${target%%.*}
  "$(command -v rustup || echo "$HOME/.cargo/bin/rustup")" target add "$triple"
  "$cargo_bin" zigbuild $flags --target "$target"
  library="target/$triple/$profile/libbamboo_native_extractor.so"
else
  "$cargo_bin" build $flags
  case "$(uname -s)" in
    Darwin) library="target/$profile/libbamboo_native_extractor.dylib" ;;
    Linux) library="target/$profile/libbamboo_native_extractor.so" ;;
    # MINGW64_NT-10.0, MSYS_NT-10.0 and the rest: one per environment a Git Bash can run in.
    *_NT-*) library="target/$profile/bamboo_native_extractor.dll" ;;
    *) echo "Unsupported build platform: $(uname -s)" >&2; exit 1 ;;
  esac
fi

cp "$library" bamboo-native-extractor.node
