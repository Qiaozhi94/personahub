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

// open workspace via 查看日志
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "查看日志");
  if (btn) btn.click();
});
await page.waitForTimeout(1500);

// The workspace panel is the RIGHT-side aside (not the sidebar). Earlier we saw
// the sidebar matched 'aside[class*="console-panel-bg"]' first. The workspace
// aside has data-testid workspace-tab-bar. Find its actual aside.
const ws = await page.evaluate(() => {
  const tabBar = document.querySelector('[data-testid="workspace-tab-bar"]');
  if (!tabBar) return { found: false };
  // climb to aside root
  let node = tabBar;
  for (let i = 0; i < 6 && node; i++) {
    if (node.tagName === "ASIDE") break;
    node = node.parentElement;
  }
  if (node.tagName !== "ASIDE") return { found: false, chain: node.tagName };
  const aside = node;
  return {
    found: true,
    asideCls: aside.className.slice(0, 90),
    // all buttons with title/aria/testid, and all clickable file-tree rows
    buttons: [...aside.querySelectorAll("button")].map((b) => ({
      text: (b.textContent || "").trim().slice(0, 30),
      title: b.getAttribute("title"),
      aria: b.getAttribute("aria-label"),
      testid: b.getAttribute("data-testid"),
      cls: (b.className || "").slice(0, 50),
    })),
    // file rows / tree nodes
    treeRows: [...aside.querySelectorAll("[data-path], [role='treeitem'], [class*='file'], [class*='File']")].map((el) => ({
      tag: el.tagName,
      cls: (el.className || "").toString().slice(0, 60),
      text: (el.textContent || "").trim().slice(0, 40),
    })).slice(0, 15),
  };
});
console.log(JSON.stringify(ws, null, 1));
await browser.close();
