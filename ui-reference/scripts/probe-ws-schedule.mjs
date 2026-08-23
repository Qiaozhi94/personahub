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

// click 调度
await page.evaluate(() => {
  const b = document.querySelector('[data-testid="workspace-tab-schedule"]');
  if (b) b.click();
});
await page.waitForTimeout(1000);

const info = await page.evaluate(() => {
  const tabBar = document.querySelector('[data-testid="workspace-tab-bar"]');
  const aside = tabBar ? tabBar.closest("aside") : null;
  if (!aside) return { aside: "gone", tabBar: !!tabBar };
  return {
    asideCls: aside.className.slice(0, 80),
    asideChildren: [...aside.children].map((c) => ({
      tag: c.tagName,
      cls: (c.className || "").toString().slice(0, 60),
      testid: c.getAttribute("data-testid"),
      len: c.innerHTML.length,
      text: (c.textContent || "").trim().slice(0, 60),
    })),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
