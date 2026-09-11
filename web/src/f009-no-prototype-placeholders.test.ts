import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { join } from "node:path";

// BC-045: the prototype's placeholder mechanics (data-demo / data-unbuilt)
// are the one "not-applicable" browser check — replaced by this reverse gate.
// Undelivered capabilities are not rendered as disabled placeholders; they are
// simply not registered (SurfaceRegistry), so the attributes must never exist
// in production source.

function listProductionFiles(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (name === "test" || name === "styles") continue;
      entries.push(...listProductionFiles(full));
    } else if ((name.endsWith(".ts") || name.endsWith(".tsx")) && !name.includes(".test.")) {
      entries.push(full);
    }
  }
  return entries;
}

const SRC_DIR = import.meta.dirname;

describe("F009 prototype placeholder ban (BC-045)", () => {
  it("contains no data-demo / data-unbuilt attributes in production source", () => {
    const violations: string[] = [];
    for (const file of listProductionFiles(SRC_DIR)) {
      const source = readFileSync(file, "utf8");
      for (const attribute of ["data-demo", "data-unbuilt"]) {
        if (source.includes(attribute)) {
          violations.push(`${file.replace(`${SRC_DIR}/`, "")}: ${attribute}`);
        }
      }
    }
    expect(violations, `prototype placeholder attributes found: ${violations.join(", ")}`).toEqual([]);
  });
});
