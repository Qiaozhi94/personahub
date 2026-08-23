// 验收：草案里用到的类名必须存在于 multica 编译后的 CSS，杜绝“自造 design system”
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";

const css = readdirSync("./assets")
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(`./assets/${f}`, "utf8"))
  .join("\n");

// 只检查“我新写的”区域：中栏与右栏（骨架区是原样保留的真值，不必检）
// Tailwind 在编译后的 CSS 里对特殊字符做了反斜杠转义（.py-1\.5 / .group\/button /
// .focus-visible\:ring-3），因此要按“转义后的选择器”去匹配，而不是按原始类名。
const esc = (c) => c.replace(/[.:/[\]()#%!,'"&<>+*~=^$]/g, (ch) => "\\" + ch);
const known = new Set();
const missing = new Map();

for (const file of readdirSync("./pages")) {
  const doc = new JSDOM(readFileSync(`./pages/${file}`, "utf8")).window.document;
  const zones = [
    doc.querySelector("div.relative.flex.h-full.min-w-0.flex-1.flex-col"),
    doc.querySelector("div.border-l"),
  ].filter(Boolean);
  for (const zone of zones) {
    for (const el of zone.querySelectorAll("*")) {
      for (const c of (el.getAttribute("class") || "").split(/\s+/).filter(Boolean)) {
        if (known.has(c)) continue;
        // group/xxx 是 Tailwind 的分组标记，自身不产生样式（只被 group-*/xxx 变体引用），
        // 且这些标记来自 multica 原样保留的按钮真值，不算自造类名。
        if (/^group\//.test(c)) { known.add(c); continue; }
        // lucide 图标类是 multica 原样保留的语义标记，自身不产生样式
        if (/^lucide(-|$)/.test(c)) { known.add(c); continue; }
        const ok = css.includes(`.${esc(c)}`);
        if (ok) known.add(c);
        else missing.set(c, (missing.get(c) || 0) + 1);
      }
    }
  }
}

if (missing.size === 0) {
  console.log(`class check PASSED — ${known.size} 个类名全部存在于 multica 编译 CSS`);
} else {
  console.log(`class check FAILED — ${missing.size} 个类名不存在：`);
  for (const [c, n] of [...missing].sort((a, b) => b[1] - a[1])) console.log(`  ${c}  ×${n}`);
  process.exitCode = 1;
}
