/**
 * Copy the current build artifacts to the configured Obsidian plugin folder.
 * Use after a build, or any time you want to re-push without rebuilding.
 *
 *   npm run deploy
 *
 * Configure the target with a `.deploy-target` file or $OBSIDIAN_PLUGIN_DIR.
 */

import process from "node:process";
import { copyArtifacts, resolveDeployDir } from "./deploy-target.mjs";

const dir = resolveDeployDir();
if (!dir) {
  console.error(
    "No deploy target set.\n" +
      "Create a `.deploy-target` file containing the plugin folder path, e.g.\n" +
      "  <vault>/.obsidian/plugins/inkedmark\n" +
      "or set OBSIDIAN_PLUGIN_DIR in the environment.",
  );
  process.exit(1);
}

const copied = copyArtifacts(dir);
if (copied.length === 0) {
  console.error(`Nothing to deploy — no build artifacts found. Run \`npm run build\` first.`);
  process.exit(1);
}
console.log(`Deployed [${copied.join(", ")}] → ${dir}`);
