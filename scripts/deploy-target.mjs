/**
 * Resolve where to copy the three Obsidian plugin artifacts and copy them.
 *
 * Target resolution (first hit wins):
 *   1. $OBSIDIAN_PLUGIN_DIR environment variable
 *   2. the trimmed contents of a gitignored `.deploy-target` file at repo root
 *
 * The target is the plugin folder itself, e.g.
 *   <vault>/.obsidian/plugins/inkedmark
 *
 * For iCloud-stored vaults this path lives under
 *   ~/Library/Mobile Documents/iCloud~md~obsidian/Documents/<Vault>/...
 * and iCloud syncs the copied files to the iPad. (Symlinks do NOT sync over
 * iCloud, which is why we copy real files.)
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const ARTIFACTS = ["manifest.json", "styles.css", "main.js"];
const TARGET_FILE = ".deploy-target";

/** @returns {string | null} absolute/relative plugin dir, or null if unset. */
export function resolveDeployDir() {
  const env = process.env.OBSIDIAN_PLUGIN_DIR;
  if (env && env.trim()) return env.trim();
  if (existsSync(TARGET_FILE)) {
    const value = readFileSync(TARGET_FILE, "utf8").trim();
    if (value) return value;
  }
  return null;
}

/**
 * Copy the built artifacts into `dir` (created if needed). Writes an empty
 * `.hotreload` marker so the desktop Hot-Reload plugin will pick up changes.
 * @param {string} dir
 */
export function copyArtifacts(dir) {
  mkdirSync(dir, { recursive: true });
  const copied = [];
  for (const file of ARTIFACTS) {
    if (existsSync(file)) {
      copyFileSync(file, join(dir, file));
      copied.push(file);
    }
  }
  writeFileSync(join(dir, ".hotreload"), "");
  return copied;
}
