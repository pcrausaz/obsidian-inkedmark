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

// Copy artifacts into the configured vault plugin folder after each successful
// build. In watch mode this fires on every rebuild, giving an edit -> vault
// (-> iCloud -> iPad) loop.
const deployPlugin = {
  name: "inkedmark-deploy",
  setup(build) {
    build.onEnd((result) => {
      if (!deployDir || result.errors.length > 0) return;
      copyArtifacts(deployDir);
      console.log(`[inkedmark] deployed → ${deployDir}`);
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
