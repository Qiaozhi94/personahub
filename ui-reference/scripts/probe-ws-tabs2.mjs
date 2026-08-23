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

const tabs = ["dev", "recall", "schedule", "tasks", "community", "artifacts", "approval", "trajectory"];
const out = {};

for (const t of tabs) {
  await page.evaluate((tid) => {
    const b = document.querySelector('[data-testid="workspace-tab-' + tid + '"]');
    if (b) b.click();
  }, t);
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const tabBar = document.querySelector('[data-testid="workspace-tab-bar"]');
    const aside = tabBar.closest("aside");
    const kids = [...aside.children];
    // content = 6th child (index 5), sub-tabs = 5th (index 4)
    const content = kids[5];
    const subTabs = kids[4];
    return {
      subTabText: subTabs ? (subTabs.textContent || "").trim().slice(0, 40) : null,
      contentCls: content ? (content.className || "").toString().slice(0, 50) : null,
      contentText: content ? (content.textContent || "").trim().slice(0, 90) : null,
      contentLen: content ? content.innerHTML.length : 0,
      contentTestids: content ? [...content.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")).slice(0, 6) : [],
    };
  });
  out[t] = info;
}

console.log(JSON.stringify(out, null, 1));
await browser.close();
