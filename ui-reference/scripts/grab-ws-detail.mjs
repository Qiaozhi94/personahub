import fs from "node:fs";
import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath:
    "C:/Users/Georg/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3003/thread/thread_mrg14xgm9ayrxp5t", {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(2500);

await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "查看日志");
  if (btn) btn.click();
});
await page.waitForTimeout(1500);

// Capture dev tab sub-tab contents (Files already captured in ws-tabs-full).
// Capture Changes, Git, Term, 🌐 content HTML.
const out = {};
for (const name of ["Changes", "Git", "Term", "🌐"]) {
  await page.evaluate((n) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === n);
    if (b) b.click();
  }, name);
  await page.waitForTimeout(800);
  const info = await page.evaluate((n) => {
    const btn = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === n);
    const row = btn.parentElement;
    const content = row.nextElementSibling;
    return content ? content.outerHTML : null;
  }, name);
  out[name] = info;
}
fs.writeFileSync("C:/Users/Georg/AppData/Local/Temp/opencode/ws-subtabs-content.json", JSON.stringify(out, null, 1));
console.log("saved subtabs:", Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v ? v.length : 0])));

// Capture the header buttons (锁定/浮出/切换到状态面板) classes + find which is 切换
const headerBtns = await page.evaluate(() => {
  const tabBar = document.querySelector('[data-testid="workspace-tab-bar"]');
  const aside = tabBar.closest("aside");
  const header = aside.firstElementChild;
  return [...header.querySelectorAll("button")].map((b) => ({
    title: b.getAttribute("title"),
    cls: b.className.slice(0, 60),
    outer: b.outerHTML.slice(0, 200),
  }));
});
fs.writeFileSync("C:/Users/Georg/AppData/Local/Temp/opencode/ws-header-btns.json", JSON.stringify(headerBtns, null, 1));
console.log("header buttons:", headerBtns.length);

// Test: 切换到状态面板 button - does it close workspace / restore status?
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("切换到状态面板"));
  if (b) b.click();
});
await page.waitForTimeout(1200);
const afterSwitch = await page.evaluate(() => ({
  wsGone: !document.querySelector('[data-testid="workspace-tab-bar"]'),
  statusBack: !!document.querySelector('[data-console-panel="status"]'),
  url: location.pathname,
}));
console.log("after 切换到状态面板:", JSON.stringify(afterSwitch));

await browser.close();
