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

// In dev state, aside children: [header, project, search, tabbar, subtabs, content]
const info = await page.evaluate(() => {
  const tabBar = document.querySelector('[data-testid="workspace-tab-bar"]');
  const aside = tabBar.closest("aside");
  const kids = [...aside.children];
  const tabBarIdx = kids.findIndex((k) => k.contains(tabBar));
  return {
    count: kids.length,
    tabBarIdx,
    kidsInfo: kids.map((k, i) => ({
      i,
      tag: k.tagName,
      cls: (k.className || "").toString().slice(0, 50),
      testid: k.getAttribute("data-testid"),
      len: k.innerHTML.length,
    })),
  };
});
console.log(JSON.stringify(info, null, 1));

// Save shell = kids[0..tabBarIdx]
const shell = await page.evaluate(() => {
  const tabBar = document.querySelector('[data-testid="workspace-tab-bar"]');
  const aside = tabBar.closest("aside");
  const kids = [...aside.children];
  const tabBarIdx = kids.findIndex((k) => k.contains(tabBar));
  return kids.slice(0, tabBarIdx + 1).map((c) => c.outerHTML).join("");
});
fs.writeFileSync("C:/Users/Georg/AppData/Local/Temp/opencode/ws-shell.html", shell);
console.log("shell saved:", shell.length, "bytes");
await browser.close();
