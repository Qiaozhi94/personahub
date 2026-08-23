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

// Open 查看日志
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "查看日志");
  if (btn) btn.click();
});
await page.waitForTimeout(1500);

// Inspect the workspace panel: header buttons (close/collapse), and how the
// right area looks now.
const ws = await page.evaluate(() => {
  const aside = document.querySelector('aside[class*="console-panel-bg"]');
  if (!aside) return { found: false };
  const header = aside.querySelector(".border-b") || aside.firstElementChild;
  const buttons = [...aside.querySelectorAll("button")].map((b) => ({
    text: (b.textContent || "").trim().slice(0, 24),
    title: b.getAttribute("title"),
    aria: b.getAttribute("aria-label"),
    testid: b.getAttribute("data-testid"),
    cls: (b.className || "").slice(0, 50),
  }));
  return {
    found: true,
    asideCls: aside.className.slice(0, 90),
    parentCls: aside.parentElement.className.slice(0, 60),
    headerHtml: header ? header.outerHTML.slice(0, 600) : null,
    buttons: buttons.slice(0, 12),
  };
});
console.log(JSON.stringify(ws, null, 1));
await browser.close();
