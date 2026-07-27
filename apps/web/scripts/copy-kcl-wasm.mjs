/**
 * @kittycad/web-view loads `/kcl_wasm_lib_bg.wasm` from the site root.
 * Copy it from @kittycad/kcl-wasm-lib into Next.js public/ before dev/build.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "../public");
const dest = join(publicDir, "kcl_wasm_lib_bg.wasm");

let src;
try {
  src = require.resolve("@kittycad/kcl-wasm-lib/kcl_wasm_lib_bg.wasm");
} catch {
  // Transitive install via @kittycad/web-view
  try {
    const webView = dirname(require.resolve("@kittycad/web-view/package.json"));
    src = join(webView, "node_modules/@kittycad/kcl-wasm-lib/kcl_wasm_lib_bg.wasm");
    if (!existsSync(src)) {
      src = require.resolve("@kittycad/kcl-wasm-lib/kcl_wasm_lib_bg.wasm", {
        paths: [webView],
      });
    }
  } catch (err) {
    console.error("[copy-kcl-wasm] Could not find kcl_wasm_lib_bg.wasm:", err);
    process.exit(1);
  }
}

mkdirSync(publicDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-kcl-wasm] ${src} -> ${dest}`);
