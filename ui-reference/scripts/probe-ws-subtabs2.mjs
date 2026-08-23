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

const subTabs = ["Files", "Changes", "Git", "Term", "🌐"];
const out = {};

for (const name of subTabs) {
  await page.evaluate((n) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === n);
    if (b) b.click();
  }, name);
  await page.waitForTimeout(800);
  const info = await page.evaluate((n) => {
    const row = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === n).parentElement;
    // content after the sub-tab row
    const content = row.nextElementSibling;
    const active = [...row.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === n);
    return {
      contentCls: content ? (content.className || "").toString().slice(0, 60) : null,
      contentText: content ? (content.textContent || "").trim().slice(0, 100) : null,
      contentLen: content ? content.innerHTML.length : 0,
      activeCls: active ? active.className : null,
    };
  }, name);
  out[name] = info;
}

console.log(JSON.stringify(out, null, 1));
await browser.close();
