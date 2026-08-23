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

const snap = () =>
  page.evaluate(() => {
    const right = document.querySelector('div[style*="288px"]');
    if (!right) return { right: "gone" };
    return {
      rightCls: right.className.slice(0, 60),
      children: [...right.children].map((c) => ({
        tag: c.tagName,
        cls: (c.className || "").toString().slice(0, 50),
        innerKids: [...c.children].map((k) => ({
          tag: k.tagName,
          panel: k.getAttribute("data-console-panel"),
          wsTab: !!k.querySelector('[data-testid="workspace-tab-bar"]'),
          hidden: (k.className || "").includes("hidden"),
          len: k.innerHTML.length,
        })),
      })),
    };
  });

console.log("BEFORE (status):");
console.log(JSON.stringify(await snap(), null, 1));

await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "查看日志");
  if (btn) btn.click();
});
await page.waitForTimeout(1500);
console.log("\nAFTER (workspace):");
console.log(JSON.stringify(await snap(), null, 1));

// switch back
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("切换到状态面板"));
  if (b) b.click();
});
await page.waitForTimeout(1200);
console.log("\nAFTER SWITCH BACK:");
console.log(JSON.stringify(await snap(), null, 1));

await browser.close();
