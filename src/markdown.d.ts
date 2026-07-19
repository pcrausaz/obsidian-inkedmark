/** Raw file text, bundled by esbuild's `text` loader (see esbuild.config.mjs). */
declare module "*.md" {
  const text: string;
  export default text;
}
