Release input: a target-specific, verified Babashka executable named `bb`
(`bb.exe` on Windows), licensed under EPL-1.0. Do not commit binaries or copy a
Mac executable into a Linux/Windows package. Pin its version and digest in the
release manifest before distributing. The developer bridge also accepts an
absolute `MEIJI_BB` path in debug builds only. No PATH fallback in release.
