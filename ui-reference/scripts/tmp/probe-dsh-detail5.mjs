/**
 * 探针 v5：DSH 轨迹详情（aside.Y0dWHa_details）——每类事件的 tab 组、每个 tab 的文本与截图。
 * 每次点 tab 前先重新点行，避免上一步误关面板。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { LAUNCH_OPTIONS } from "../config.mjs";

const OUT = "D:/Projects/personahub/ui-reference/scripts/tmp/dsh-detail5";
await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ ...LAUNCH_OPTIONS, headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
await page.goto("http://127.0.0.1:3080/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.getByText("拉取项目最新代码").first().click({ timeout: 10000 });
await page.waitForTimeout(1200);
await page.getByText("轨迹", { exact: true }).first().click({ timeout: 10000 });
await page.waitForTimeout(1800);

const rowSel = '[class*="_event"]:not([class*="eventColumn"]):not([class*="eventHeader"]):not([class*="eventInner"])';
const rows = await page.evaluate(
  (sel) =>
    [...document.querySelectorAll(sel)].map((r, i) => ({
      i,
      kind: r.querySelector('[class*="kindTagLabel"]')?.textContent.trim() ?? "",
    })),
  rowSel,
);
const details = page.locator('aside[class*="_details"]');

const openRow = async (i) => {
  const loc = page.locator(rowSel).nth(i);
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(700);
};

const dump = () =>
  page.evaluate(() => {
    const col = document.querySelector('aside[class*="_details"]');
    if (!col) return null;
    const cls = (el) => (el.className || "").toString().split(/\s+/).filter(Boolean).join(".");
    const skeleton = (el, depth = 0) => {
      if (!el || depth > 8) return "";
      return [...el.children]
        .map((c) => {
          const own = [...c.childNodes]
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent.trim())
            .filter(Boolean)
            .join(" ")
            .slice(0, 300);
          return `${"  ".repeat(depth)}<${c.tagName.toLowerCase()}${cls(c) ? "." + cls(c) : ""}> ${own}\n${skeleton(c, depth + 1)}`;
        })
        .join("");
    };
    const tabs = [...col.querySelectorAll('[class*="detailTab"]')]
      .filter((b) => b.tagName === "BUTTON")
      .map((b) => ({ text: b.textContent.trim(), active: /Active/.test(b.className) }));
    return { text: col.innerText, skeleton: skeleton(col), tabs, header: col.querySelector('[class*="detailsHeader"]')?.innerText ?? "" };
  });

const seen = new Set();
for (const row of rows) {
  if (!row.kind || seen.has(row.kind)) continue;
  seen.add(row.kind);
  await openRow(row.i);
  const first = await dump();
  if (!first) {
    console.log(`[${row.kind}] 点开后没有详情面板`);
    await fs.writeFile(path.join(OUT, `${row.kind}.txt`), "(点开后没有详情面板)");
    continue;
  }
  const tabs = first.tabs.map((t) => t.text).filter(Boolean);
  const parts = [`kind: ${row.kind}`, `header: ${first.header.replace(/\n/g, " | ")}`, `tabs: ${tabs.join(" / ")}`, "", `===== 默认 tab (${first.tabs.find((t) => t.active)?.text ?? "?"}) =====`, first.text];
  await details.screenshot({ path: path.join(OUT, `${row.kind}--default.png`) }).catch(() => {});

  for (const t of tabs) {
    await openRow(row.i);
    const btn = details.locator('button[class*="detailTab"]', { hasText: t }).first();
    await btn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    const cur = await dump();
    parts.push(`\n===== tab: ${t} =====\n${cur?.text ?? "(空)"}`);
    await details.screenshot({ path: path.join(OUT, `${row.kind}--${t.replace(/\W+/g, "_")}.png`) }).catch(() => {});
  }
  parts.push("\n===== 结构 =====\n" + first.skeleton);
  await fs.writeFile(path.join(OUT, `${row.kind}.txt`), parts.join("\n"));
  console.log(`[${row.kind}] ${tabs.join(" / ")}`);
}

await browser.close();
console.log("输出：", OUT);
