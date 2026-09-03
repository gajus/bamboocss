#!/bin/sh
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
if [ "${1:-}" = '--release' ]; then
  profile=release
  "$cargo_bin" build --locked --release
else
  "$cargo_bin" build --locked
fi

case "$(uname -s)" in
  Darwin) library="target/$profile/libbamboo_native_extractor.dylib" ;;
  Linux) library="target/$profile/libbamboo_native_extractor.so" ;;
  MINGW*|MSYS*|CYGWIN*) library="target/$profile/bamboo_native_extractor.dll" ;;
  *) echo "Unsupported build platform: $(uname -s)" >&2; exit 1 ;;
esac

cp "$library" bamboo-native-extractor.node
