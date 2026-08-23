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

// In dev tab, the sub-tabs are Files/Changes/Git/Term/🌐. Click each and
// capture the content area below them.
const subTabs = ["Files", "Changes", "Git", "Term", "🌐"];
const out = {};

// find the sub-tab row: buttons with exact text Files/Changes/Git/Term
const subRowInfo = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter((b) => {
    const t = (b.textContent || "").trim();
    return ["Files", "Changes", "Git", "Term", "🌐"].includes(t);
  });
  const row = btns.length ? btns[0].parentElement : null;
  return {
    count: btns.length,
    rowCls: row ? row.className : null,
    rowHtml: row ? row.outerHTML.slice(0, 500) : null,
    btns: btns.map((b) => ({ text: (b.textContent || "").trim(), cls: b.className.slice(0, 100) })),
  };
});
console.log("SUBROW:", JSON.stringify(subRowInfo, null, 1));
await browser.close();
