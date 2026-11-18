// AWAI-3170: let a DEBUG build trust the per-run EN devnet desk CA, and nothing else.
//
//   node scripts/devnet-trust.mjs install CA.pem   # writes the debug-only overlay
//   node scripts/devnet-trust.mjs remove           # deletes it
//
// The overlay lives in the debug source set (app/src/debug), is git-ignored and is written fresh for
// each run. It uses network_security_config debug-overrides, which Android applies only to a
// debuggable build: the release build, its manifest and cleartext=false are unchanged. The CA's
// private key never leaves the harness output directory.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const debug = fileURLToPath(new URL("../src-tauri/gen/android/app/src/debug/", import.meta.url));
const [command, caFile] = process.argv.slice(2);

if (command === "remove") {
  await rm(debug, { recursive: true, force: true });
  console.log("removed debug devnet trust overlay");
} else if (command === "install" && caFile) {
  const pem = await readFile(caFile, "utf8");
  const cert = new X509Certificate(pem);
  if (!cert.ca || !/Awai devnet support CA/.test(cert.subject)) throw Error("not an Awai devnet support CA");
  await mkdir(path.join(debug, "res/raw"), { recursive: true });
  await mkdir(path.join(debug, "res/xml"), { recursive: true });
  await writeFile(path.join(debug, "res/raw/awai_devnet_support_ca.pem"), pem);
  await writeFile(path.join(debug, "res/xml/awai_devnet_nsc.xml"), `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated for one EN devnet run (AWAI-3170). Debug builds only; not committed. -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <debug-overrides>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="@raw/awai_devnet_support_ca" />
        </trust-anchors>
    </debug-overrides>
</network-security-config>
`);
  await writeFile(path.join(debug, "AndroidManifest.xml"), `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated for one EN devnet run (AWAI-3170). Debug builds only; not committed. -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:networkSecurityConfig="@xml/awai_devnet_nsc" />
</manifest>
`);
  console.log(`installed debug devnet trust overlay for ${cert.subject} (sha256 ${cert.fingerprint256})`);
} else {
  console.error("usage: devnet-trust.mjs install CA.pem | remove");
  process.exit(2);
}
