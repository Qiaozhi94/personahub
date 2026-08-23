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
    // header, project, (search for dev), tab-bar, then content(s)
    const tabBarIdx = kids.indexOf(tabBar.parentElement) + 1; // index of tab-bar row
    // content = everything after the tab bar row
    const content = kids.slice(tabBarIdx + 1);
    const activeTab = document.querySelector('[data-testid="workspace-tab-' + tid + '"]');
    return {
      activeCls: activeTab ? activeTab.className.slice(0, 80) : null,
      content: content.map((c) => ({
        cls: (c.className || "").toString().slice(0, 60),
        testid: c.getAttribute("data-testid"),
        len: c.innerHTML.length,
        text: (c.textContent || "").trim().slice(0, 60),
      })),
    };
  }, t);
  out[t] = info;
}

fs.writeFileSync("C:/Users/Georg/AppData/Local/Temp/opencode/ws-tab-structure.json", JSON.stringify(out, null, 1));
console.log("saved. per-tab content blocks:");
for (const [k, v] of Object.entries(out)) {
  console.log(k, "->", v.content.map((c) => c.cls + "(" + c.len + ")").join(" | "));
}
await browser.close();
