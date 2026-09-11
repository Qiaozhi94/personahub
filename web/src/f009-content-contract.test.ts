import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { join } from "node:path";

// F009 production-copy contract (BC-044 / BC-119 / BC-122 / BC-123 / BC-124):
// the interface states facts and actions only. It never shows design-process
// vocabulary, never qualifies the product as single-user / local-only, never
// uses the word the design reserves for prototype overlays, and never lets an
// explanatory paragraph exceed the V3.44 length budget.

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
const PRODUCTION_FILES = listProductionFiles(SRC_DIR);
const PRODUCTION_SOURCES = PRODUCTION_FILES.map((file) => ({
  file: file.replace(`${SRC_DIR}/`, ""),
  source: readFileSync(file, "utf8"),
}));

const FORBIDDEN_COPY = [
  // BC-123: the prototype's overlay vocabulary never enters the interface.
  "弹层",
  // BC-124: design-process vocabulary stays in the docs.
  "原型",
  "设计稿",
  "设计过程",
  "迁移矩阵",
  " transitional",
  "SurfaceRegistry",
  "transitional-host",
  // BC-122: the UI does not qualify the product as single-machine.
  "本机",
  "单用户",
  "单机",
  // BC-105 (deferred): path authorization's final UI is F013's, but the
  // term itself never shows up as a stray/double name in F009's compat UI.
  "权限档",
];

describe("F009 production copy contract", () => {
  it("never uses prototype/design/single-machine vocabulary", () => {
    const violations: string[] = [];
    for (const { file, source } of PRODUCTION_SOURCES) {
      // User-facing copy lives in string literals; identifiers and comments
      // are never rendered to the user.
      const literals = source.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g) ?? [];
      for (const literal of literals) {
        for (const phrase of FORBIDDEN_COPY) {
          if (literal.includes(phrase)) violations.push(`${file}: ${phrase.trim()}`);
        }
      }
    }
    expect(violations, `forbidden production copy: ${violations.join(", ")}`).toEqual([]);
  });

  it("keeps every explanation string within the V3.44 length budget (BC-044)", () => {
    const violations: string[] = [];
    for (const { file, source } of PRODUCTION_SOURCES) {
      // Chinese explanatory strings: single strings carrying CJK characters.
      const literals = source.match(/"(?:[^"\\\n]|\\.)*[一-鿿](?:[^"\\\n]|\\.)*"/g) ?? [];
      for (const literal of literals) {
        const text = literal.slice(1, -1);
        if (text.length > 150) violations.push(`${file}: ${text.slice(0, 40)}… (${text.length} chars)`);
      }
    }
    expect(violations, `copy exceeding 150 chars: ${violations.join("; ")}`).toEqual([]);
  });

  it("labels the UI in the frozen V3.44 vocabulary", () => {
    // Surface labels come from the frozen manifest, one name per object.
    const registry = PRODUCTION_SOURCES.find(({ file }) => file.endsWith("surface-registry.ts"))!;
    for (const label of ["任务", "会话", "项目", "自动化", "记忆", "能力", "运行时", "统计", "设置"]) {
      expect(registry.source.includes(`label: "${label}"`), `surface label ${label}`).toBe(true);
    }
  });
});
