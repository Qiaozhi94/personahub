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

// For each workspace main tab, capture the panel content area (the region
// below the tab bar that changes).
const tabs = ["dev", "recall", "schedule", "tasks", "community", "artifacts", "approval", "trajectory"];

const results = {};
for (const t of tabs) {
  await page.evaluate((tid) => {
    const b = document.querySelector('[data-testid="workspace-tab-' + tid + '"]');
    if (b) b.click();
  }, t);
  await page.waitForTimeout(700);
  const info = await page.evaluate(() => {
    const tabBar = document.querySelector('[data-testid="workspace-tab-bar"]');
    const aside = tabBar.closest("aside");
    // the panel is everything in the aside below the tab bar (roughly)
    const tabBarEnd = tabBar.parentElement; // tab bar container
    // find the workspace content root: sibling after tab bar
    let content = tabBar.parentElement.nextElementSibling;
    let guard = 0;
    while (content && guard < 4) {
      const cls = (content.className || "").toString();
      const len = content.innerHTML.length;
      if (len > 100 && !cls.includes("hidden")) break;
      content = content.nextElementSibling;
      guard++;
    }
    return {
      contentCls: content ? (content.className || "").toString().slice(0, 60) : null,
      contentText: content ? (content.textContent || "").trim().slice(0, 120) : null,
      contentLen: content ? content.innerHTML.length : 0,
      testids: content ? [...content.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")).slice(0, 8) : [],
    };
  });
  results[t] = info;
}

console.log(JSON.stringify(results, null, 1));
await browser.close();
