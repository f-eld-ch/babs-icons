import { execSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(ROOT, ".smoke-tmp");

type ExportsMap = Record<string, string | { types?: string; default?: string }>;

interface PackageJson {
  name: string;
  exports?: ExportsMap;
}

function packAndUnpack(pkg: string): string {
  const pkgDir = join(ROOT, "packages", pkg);
  execSync("yarn pack --out smoke.tgz", { cwd: pkgDir, stdio: "pipe" });
  const tarball = join(pkgDir, "smoke.tgz");
  const unpackDir = join(TMP, pkg);
  mkdirSync(unpackDir, { recursive: true });
  execSync(`tar xzf ${tarball} -C ${unpackDir} --strip-components=1`);
  rmSync(tarball);
  return unpackDir;
}

beforeAll(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP);
});

afterAll(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

const PACKAGES = ["core", "react", "sprites", "assets"] as const;

for (const pkg of PACKAGES) {
  const pkgDir = join(ROOT, "packages", pkg);
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as PackageJson;
  const exports = pkgJson.exports ?? {};

  describe(pkgJson.name, () => {
    let unpackDir: string;

    beforeAll(() => {
      unpackDir = packAndUnpack(pkg);
    });

    for (const [specifier, value] of Object.entries(exports)) {
      if (specifier === "./package.json") continue;

      const defaultPath = typeof value === "string" ? value : (value.default ?? null);
      const typesPath = typeof value === "object" ? (value.types ?? null) : null;

      if (defaultPath && !defaultPath.includes("*")) {
        it(`${specifier} default entry exists`, () => {
          expect(existsSync(join(unpackDir, defaultPath)), `${defaultPath} not in tarball`).toBe(true);
        });
      }

      if (typesPath && !typesPath.includes("*")) {
        it(`${specifier} types entry exists`, () => {
          expect(existsSync(join(unpackDir, typesPath)), `${typesPath} not in tarball`).toBe(true);
        });
      }
    }

    if (pkg === "assets") {
      for (const lang of ["de", "fr", "it"] as const) {
        it(`svg/${lang}/ is present and non-empty`, () => {
          const d = join(unpackDir, "svg", lang);
          expect(existsSync(d), `svg/${lang}/ missing`).toBe(true);
          expect(readdirSync(d).length, `svg/${lang}/ is empty`).toBeGreaterThan(0);
        });
      }
    }

    if (pkg === "sprites") {
      it("layout.lock.json is present", () => {
        expect(existsSync(join(unpackDir, "layout.lock.json"))).toBe(true);
      });
    }
  });
}
