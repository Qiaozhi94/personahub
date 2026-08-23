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

// snapshot the RIGHT panel region (after the chat area) - use a different locator
const layoutBefore = await page.evaluate(() => {
  const shell = document.querySelector(".console-shell");
  const row = shell.children[3]; // the flex h-screen row? let's dump
  return {
    shellKids: [...shell.children].map((c) => c.tagName + ":" + (c.className || "").toString().slice(0, 40)),
  };
});
console.log("shell kids BEFORE:", JSON.stringify(layoutBefore));

await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "查看日志");
  if (btn) btn.click();
});
await page.waitForTimeout(1500);

const layoutAfter = await page.evaluate(() => {
  const shell = document.querySelector(".console-shell");
  // Find the flex h-screen row: it has the chat column + right panel
  const hRow = [...shell.querySelectorAll("div")].find((d) => {
    const c = (d.className || "").toString();
    return c.includes("flex h-screen") && d.children.length >= 3;
  });
  if (!hRow) return { hRow: "none" };
  return {
    hRowKids: [...hRow.children].map((c) => ({
      tag: c.tagName,
      cls: (c.className || "").toString().slice(0, 50),
      testid: c.getAttribute("data-testid"),
    })),
  };
});
console.log("layout AFTER:", JSON.stringify(layoutAfter, null, 1));
await browser.close();
