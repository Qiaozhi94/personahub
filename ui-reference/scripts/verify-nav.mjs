#!/usr/bin/env node
/**
 * Navigation regression check.
 *
 * Walks every captured page, follows every internal link and every configured
 * click-nav target, and reports anything that leads nowhere. Run it after any
 * change to routes or the runtime — a broken archive looks fine until someone
 * clicks, and clicking 22 pages by hand is how link rot survives.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { LAUNCH_OPTIONS, pagesDir, projectConfig } from "./config.mjs";

const slug = process.argv[2] ?? "multica";
const project = projectConfig(slug);
const dir = pagesDir(slug);
const fileUrl = (name) => "file:///" + path.join(dir, name).replace(/\\/g, "/");

const browser = await chromium.launch(LAUNCH_OPTIONS);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const existing = new Set(await fs.readdir(dir).catch(() => []));
let dead = 0;
let live = 0;
let clickNav = 0;
const report = [];

for (const p of project.pages) {
  if (!existing.has(`${p.name}.html`)) continue;
  await page.goto(fileUrl(`${p.name}.html`));

  const links = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")]
      .map((a) => a.getAttribute("href"))
      .filter((h) => h && !h.startsWith("#") && !h.startsWith("http")),
  );
  const missing = [...new Set(links)].filter(
    (h) => !existing.has(h.split(/[?#]/)[0]),
  );
  live += links.length;
  if (missing.length) report.push(`${p.name}: broken -> ${missing.join(", ")}`);

  const deadCount = await page.evaluate(
    () => document.querySelectorAll('a[href="#"][data-original-href]').length,
  );
  dead += deadCount;

  // Click-nav rules only pay off if the selector matches something.
  const rules = (project.routes?.clickNav ?? []).filter((r) => r.page === p.name);
  for (const rule of rules) {
    const count = await page.locator(rule.selector).count();
    if (count === 0) {
      report.push(`${p.name}: clickNav selector matches nothing -> ${rule.selector}`);
      continue;
    }
    // Rows include a header row that must not navigate; the last one is real.
    // Click well inside the row: the sidebar rail is absolutely positioned and
    // overlaps the first ~16px of the content area, so a click near x=0 lands
    // on the rail instead of the row.
    const target = page.locator(rule.selector).last();
    await target.click({ position: { x: 200, y: 10 } }).catch(() => {});
    await page.waitForTimeout(120);
    const landed = path.basename(new URL(page.url()).pathname);
    if (landed !== `${rule.to}.html`) {
      report.push(`${p.name}: click on ${rule.selector} landed on ${landed}, expected ${rule.to}.html`);
    } else {
      clickNav += 1;
    }
    await page.goto(fileUrl(`${p.name}.html`));
  }
}

await browser.close();

console.log(`links followed: ${live}, all resolve to a captured page unless listed below`);
console.log(`click-nav rules working: ${clickNav}`);
console.log(`inert links (route not captured): ${dead}`);
if (report.length) {
  console.log("\nproblems:");
  for (const line of report) console.log("  " + line);
  process.exitCode = 1;
} else {
  console.log("\nok — nothing leads nowhere");
}
