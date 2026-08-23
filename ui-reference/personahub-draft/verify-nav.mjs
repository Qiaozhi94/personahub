// 交互验收：跳转不许死、开关必须真的切换、点不了的必须自报为什么
//
// 三类检查：
// 1. 站内链接与 onclick 跳转的目标页必须存在
// 2. 每个 data-switch 点下去，对应面板真的显示、其余隐藏
// 3. 任何可点元素若不导致任何变化，必须带 title 说明原因（禁止「点了没反应」）
import { chromium } from "playwright";
import { readdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { LAUNCH_OPTIONS } from "../scripts/config.mjs";

const pages = readdirSync("./pages").filter((f) => f.endsWith(".html"));
const browser = await chromium.launch(LAUNCH_OPTIONS);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let failed = 0;

for (const file of pages) {
  const problems = [];
  await page.goto(pathToFileURL(`./pages/${file}`).href);

  // 1. 跳转目标存在
  const targets = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("a[href]").forEach((a) => {
      const h = a.getAttribute("href");
      if (h && h.endsWith(".html")) out.push({ to: h, label: a.textContent.trim().slice(0, 20) });
    });
    document.querySelectorAll("[onclick]").forEach((el) => {
      const m = /location\.href='([^']+)'/.exec(el.getAttribute("onclick") || "");
      if (m) out.push({ to: m[1], label: el.textContent.trim().slice(0, 20) });
    });
    return out;
  });
  for (const t of targets) {
    if (!existsSync(`./pages/${t.to}`)) problems.push(`死链 ${t.to}（${t.label}）`);
  }

  // 折叠态页面先展开 Inspector，否则它那组 tab 不可见、测不到
  const expander = await page.$("[data-toggle-inspector]");
  if (expander) await expander.click();

  // 2. 开关真的切换（只测可见的触发器；不可见的由所属折叠区自己负责）
  const groups = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll("[data-switch]")].map((e) => e.dataset.switch))],
  );
  for (const group of groups) {
    const triggers = await page.$$(`[data-switch="${group}"]`);
    for (const trigger of triggers) {
      const target = await trigger.getAttribute("data-target");
      if (!(await trigger.isVisible())) continue;
      await trigger.click();
      const ok = await page.evaluate(
        ([g, t]) =>
          [...document.querySelectorAll(`[data-panel="${g}"]`)].every((p) =>
            p.id === t ? !p.hidden : p.hidden,
          ),
        [group, target],
      );
      if (!ok) problems.push(`开关无效 ${group} → ${target}`);
    }
  }

  // 3. 不可点的必须自报原因
  const silent = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("button").forEach((b) => {
      const inert =
        !b.hasAttribute("onclick") &&
        !b.hasAttribute("data-switch") &&
        !b.hasAttribute("data-toggle-inspector") &&
        !b.hasAttribute("data-collapse-inspector") &&
        !b.closest("a[href$='.html']");
      if (inert && !b.getAttribute("title")) {
        const label = (b.textContent || "").trim();
        if (label) out.push(label.slice(0, 20));
      }
    });
    document.querySelectorAll("a[href='#']").forEach((a) => {
      if (!a.getAttribute("title") && !a.hasAttribute("data-switch"))
        out.push(`链接「${(a.textContent || "").trim().slice(0, 16)}」`);
    });
    return out;
  });
  for (const label of silent) problems.push(`点了没反应且未说明：${label}`);

  if (problems.length) failed++;
  console.log(
    `${problems.length ? "FAIL" : "ok  "} ${file.replace(/\.html$/, "")}` +
      (problems.length ? ` | ${problems.join(" | ")}` : ` | ${targets.length} 条跳转、${groups.length} 组开关`),
  );
}

await browser.close();
console.log(failed ? `\n${failed} 页未通过` : "\n交互验收全部通过");
process.exitCode = failed ? 1 : 0;
