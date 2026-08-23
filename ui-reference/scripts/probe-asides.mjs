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

const allAsides = () =>
  page.evaluate(() => {
    return [...document.querySelectorAll("aside")].map((a, i) => ({
      i,
      cls: (a.className || "").toString().slice(0, 60),
      panel: a.getAttribute("data-console-panel"),
      hasWsTab: !!a.querySelector('[data-testid="workspace-tab-bar"]'),
      hidden: (a.className || "").includes("hidden"),
      parentCls: a.parentElement ? (a.parentElement.className || "").toString().slice(0, 50) : null,
      len: a.innerHTML.length,
    }));
  });

console.log("ASIDES BEFORE:");
console.log(JSON.stringify(await allAsides(), null, 1));

await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "查看日志");
  if (btn) btn.click();
});
await page.waitForTimeout(1500);
console.log("\nASIDES AFTER 查看日志:");
console.log(JSON.stringify(await allAsides(), null, 1));

await browser.close();
