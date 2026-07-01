import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

// Run as the npm `version` lifecycle script: package.json has already been
// bumped, so `npm_package_version` is the new target. Propagate it into
// manifest.json (the runtime source of truth) and versions.json.
const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  throw new Error("npm_package_version is not set; run via `npm version`.");
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");

console.log(`Bumped manifest + versions to ${targetVersion} (minAppVersion ${minAppVersion}).`);
