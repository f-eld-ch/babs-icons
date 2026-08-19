// @f-eld-ch/babs-sprites/vite — Node only, vite is an optional peer
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import type { Plugin } from "vite";

const SHEET_RE = /^babs-(de|fr|it)(@2x)?\.(json|png)$/;

/**
 * Vite plugin that serves and emits BABS sprite sheets at a fixed, unhashed path.
 *
 * Dev:   serves sheets directly from node_modules — no copy, always fresh.
 * Build: emits with exact `fileName` (bypasses Rollup's content-hash renaming).
 *
 * @param path  Output path inside the public/dist folder. Defaults to "map/sprites".
 */
export function babsSprites({ path = "map/sprites" }: { path?: string } = {}): Plugin {
  const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
  const base = path.replace(/^\/+|\/+$/g, "");

  return {
    name: "babs-sprites",

    configureServer(server) {
      const prefix = `/${base}`;
      server.middlewares.use(prefix, (req, res, next) => {
        const file = (req.url ?? "").split("?")[0]!.replace(/^\/+/, "");
        if (!SHEET_RE.test(file)) {
          next();
          return;
        }
        res.setHeader(
          "Content-Type",
          file.endsWith(".json") ? "application/json" : "image/png",
        );
        createReadStream(distDir + file).pipe(res);
      });
    },

    async generateBundle() {
      const files = await readdir(distDir);
      for (const f of files) {
        if (!SHEET_RE.test(f)) continue;
        const source = await readFile(distDir + f);
        this.emitFile({ type: "asset", fileName: `${base}/${f}`, source });
      }
    },
  };
}
