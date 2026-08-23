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
  await page.waitForTimeout(900);

  const info = await page.evaluate((tid) => {
    const tabBar = document.querySelector('[data-testid="workspace-tab-bar"]');
    const aside = tabBar.closest("aside");
    const kids = [...aside.children];
    const tabBarRow = tabBar.parentElement;
    const tabBarIdx = kids.indexOf(tabBarRow);
    // everything after the tab bar row
    const content = kids.slice(tabBarIdx + 1);
    // active tab class
    const active = document.querySelector('[data-testid="workspace-tab-' + tid + '"]');
    // all tabs classes (to know active/inactive pattern)
    const tabClasses = [...tabBarRow.querySelectorAll("button")].map((b) => ({
      testid: b.getAttribute("data-testid"),
      cls: b.className.slice(0, 100),
    }));
    return {
      contentHtml: content.map((c) => c.outerHTML).join(""),
      activeCls: active ? active.className : null,
      tabClasses,
    };
  }, t);
  out[t] = info;
}

fs.writeFileSync("C:/Users/Georg/AppData/Local/Temp/opencode/ws-tabs-full.json", JSON.stringify(out, null, 1));
console.log("saved. content sizes:");
for (const [k, v] of Object.entries(out)) {
  console.log(k, "-> content", v.contentHtml.length, "bytes | activeCls:", (v.activeCls || "").slice(0, 60));
}
await browser.close();
