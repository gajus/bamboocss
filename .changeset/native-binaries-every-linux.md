---
'@bamboocss/node': patch
---

The bundled native binary loads on every Linux that Node 22 runs on, and on Alpine and Windows on Arm, which had none.

- The glibc binaries needed glibc 2.34, the release on the machines that built them, so Debian 11, Ubuntu 20.04 and RHEL
  8 failed with `GLIBC_2.33 not found` although Node 22 itself needs only 2.28. They now need no glibc newer than 2.17,
  and the release loads each one on RHEL 8 before publishing it.
- Alpine got the glibc binary, which failed on x64 for want of glibc's dynamic loader and loaded on arm64 only because
  musl's loader does not check the glibc versions it is asked for. `@bamboocss/node` now ships musl binaries for arm64
  and x64, and loads one where Node runs on musl.
- Windows on Arm had no binary. Both Windows binaries now link the C runtime in, so neither needs the Visual C++
  Redistributable installed.
