import esbuild from "esbuild";
import process from "node:process";
import builtins from "builtin-modules";
import { copyArtifacts, resolveDeployDir } from "./scripts/deploy-target.mjs";

const banner = `/*
InkedMark — bundled plugin output. Do not edit directly.
Source: https://github.com/pcrausaz/obsidian-inkedmark
*/`;

const production = process.argv[2] === "production";
const deployDir = resolveDeployDir();

// A per-build stamp (local time, to the second) surfaced in the toolbar so a
// tester can confirm which build is actually running — important when iCloud
// sync latency makes "is the new build on the iPad yet?" ambiguous.
const now = new Date();
const p2 = (n) => String(n).padStart(2, "0");
const buildId =
  `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}` +
  `-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;

// Copy artifacts into the configured vault plugin folder after each successful
// build. In watch mode this fires on every rebuild, giving an edit -> vault
// (-> iCloud -> iPad) loop.
const deployPlugin = {
  name: "inkedmark-deploy",
  setup(build) {
    build.onEnd((result) => {
      if (!deployDir || result.errors.length > 0) return;
      copyArtifacts(deployDir);
      console.log(`[inkedmark] deployed ${buildId} → ${deployDir}`);
    });
  },
};

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  define: {
    __INKEDMARK_BUILD__: JSON.stringify(buildId),
  },
  outfile: "main.js",
  minify: production,
  plugins: [deployPlugin],
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
