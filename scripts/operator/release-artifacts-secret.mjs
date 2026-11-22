#!/usr/bin/env node
// Copies the bucket-scoped B2 key for awai-os-release-artifacts from the
// operator Keychain into a Secret in the release build namespace.
// The key travels only through pipes: never argv, logs or files.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const keychainService = "network.awai.release-artifacts.b2";
export const keychainAccount = "awai-os-release-artifacts-build";

export function secretManifest(namespace, name, stored) {
  const match = /^([0-9a-f]{25}):([A-Za-z0-9+/]{31})$/.exec(stored.trim());
  if (!match) throw new Error("The Keychain item is not a B2 application key (keyId:applicationKey).");
  return {
    apiVersion: "v1", kind: "Secret", type: "Opaque",
    metadata: { name, namespace, labels: { "awai.network/purpose": "release-build" } },
    stringData: { RCLONE_CONFIG_ART_TYPE: "b2", RCLONE_CONFIG_ART_ACCOUNT: match[1], RCLONE_CONFIG_ART_KEY: match[2] },
  };
}

function main([namespace, name]) {
  if (!namespace || !name) throw new Error("Usage: release-artifacts-secret.mjs NAMESPACE SECRET_NAME");
  const read = spawnSync("security", ["find-generic-password", "-s", keychainService, "-a", keychainAccount, "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (read.status !== 0) throw new Error(`Keychain item ${keychainService}/${keychainAccount} is missing.`);
  const create = spawnSync("kubectl", ["-n", namespace, "create", "-f", "-", "-o", "name"], {
    input: JSON.stringify(secretManifest(namespace, name, read.stdout)),
    encoding: "utf8", stdio: ["pipe", "inherit", "inherit"], timeout: 60_000,
  });
  if (create.status !== 0) throw new Error(`Could not create Secret ${namespace}/${name}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
