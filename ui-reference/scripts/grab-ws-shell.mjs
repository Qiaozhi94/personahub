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

// Capture the workspace aside SHELL: header + project row + tab bar row
// (everything up to and including the tab bar). Content below is swapped.
const shell = await page.evaluate(() => {
  const tabBar = document.querySelector('[data-testid="workspace-tab-bar"]');
  const aside = tabBar.closest("aside");
  const kids = [...aside.children];
  const tabBarRow = tabBar.parentElement;
  const tabBarIdx = kids.indexOf(tabBarRow);
  // shell = kids[0..tabBarIdx] inclusive (header, project, search?, tab bar)
  // but dev has a search form between project and tab bar. For other tabs it's
  // absent. We'll capture the dev shell (with search) as the canonical shell.
  const shellHtml = kids.slice(0, tabBarIdx + 1).map((c) => c.outerHTML).join("");
  return { shellHtml, asideCls: aside.className };
});

fs.writeFileSync("C:/Users/Georg/AppData/Local/Temp/opencode/ws-shell.html", shell.shellHtml);
console.log("shell saved:", shell.shellHtml.length, "bytes");
console.log("aside cls:", shell.asideCls.slice(0, 80));
await browser.close();
