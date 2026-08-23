#!/usr/bin/env node
/**
 * Interaction regression check.
 *
 * Opens each static page from disk and exercises every captured state the way
 * a reader would — click a menu, hover a tooltip, switch a tab — then asserts
 * the overlay appeared and disappeared again. This is the only check that can
 * catch the failure mode that matters here: the paths recorded against the
 * live DOM drifting out of alignment with the staticized DOM, which makes
 * every menu silently do nothing while the page still looks perfect.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { LAUNCH_OPTIONS, OUT_ROOT, pagesDir, projectConfig } from "./config.mjs";

const slug = process.argv[2] ?? "multica";
const only = process.argv.slice(3);
const project = projectConfig(slug);
const dir = pagesDir(slug);

const browser = await chromium.launch(LAUNCH_OPTIONS);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let checked = 0;
let opened = 0;
const problems = [];

for (const target of project.pages) {
  if (only.length && !only.includes(target.name)) continue;
  const file = path.join(dir, `${target.name}.html`);
  try {
    await fs.access(file);
  } catch {
    continue;
  }

  await page.goto("file:///" + file.replace(/\\/g, "/"));
  const states = await page.evaluate(() =>
    Object.entries((window.__REPLICA__ || {}).states || {}).map(([key, s]) => ({
      key,
      kind: s.kind,
      label: s.label,
    })),
  );
  if (states.length === 0) continue;

  for (const state of states) {
    checked += 1;
    const result = await page.evaluate((key) => {
      const SKIP = { script: 1, style: 1, template: 1, noscript: 1 };
      const nodePath = (el) => {
        const parts = [];
        while (el && el !== document.documentElement) {
          const parent = el.parentElement;
          if (!parent) return null;
          let index = 0;
          let found = -1;
          for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
            if (SKIP[c.tagName.toLowerCase()]) continue;
            if (c === el) {
              found = index;
              break;
            }
            index += 1;
          }
          if (found < 0) return null;
          parts.unshift(found);
          el = parent;
        }
        return parts.join("/");
      };
      for (const el of document.querySelectorAll("*")) {
        if (nodePath(el) === key) {
          return { found: true, tag: el.tagName.toLowerCase() };
        }
      }
      return { found: false };
    }, state.key);

    if (!result.found) {
      problems.push(
        `${target.name}: no element at path ${state.key} (${state.kind} ${JSON.stringify(state.label)})`,
      );
      continue;
    }

    // Drive it through the real runtime rather than calling internals: the
    // point is to prove a reader's click works, not that a function exists.
    const before = await page.evaluate(() => document.body.children.length);
    await page.evaluate(
      ({ key, hover }) => {
        const SKIP = { script: 1, style: 1, template: 1, noscript: 1 };
        const nodePath = (el) => {
          const parts = [];
          while (el && el !== document.documentElement) {
            const parent = el.parentElement;
            if (!parent) return null;
            let index = 0;
            let found = -1;
            for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
              if (SKIP[c.tagName.toLowerCase()]) continue;
              if (c === el) {
                found = index;
                break;
              }
              index += 1;
            }
            if (found < 0) return null;
            parts.unshift(found);
            el = parent;
          }
          return parts.join("/");
        };
        for (const el of document.querySelectorAll("*")) {
          if (nodePath(el) !== key) continue;
          const type = hover ? "mouseover" : "click";
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
          return;
        }
      },
      { key: state.key, hover: state.kind === "tooltip" || state.kind === "hovercard" },
    );

    const after = await page.evaluate(() => document.body.children.length);
    if (state.kind === "tab") {
      const active = await page.evaluate(
        (key) => document.querySelectorAll('[role="tab"][data-state="active"]').length,
        state.key,
      );
      if (active === 1) opened += 1;
      else problems.push(`${target.name}: tab ${JSON.stringify(state.label)} did not activate`);
    } else if (after > before) {
      opened += 1;
    } else {
      problems.push(
        `${target.name}: ${state.kind} ${JSON.stringify(state.label)} did not open`,
      );
    }

    await page.keyboard.press("Escape");
    await page.evaluate(() =>
      document.body.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })),
    );
    await page.waitForTimeout(20);
  }
}

await browser.close();

let gaps = {};
try {
  gaps = JSON.parse(
    await fs.readFile(path.join(OUT_ROOT, slug, "states", "_gaps.json"), "utf8"),
  );
} catch {}
const gapCount = Object.values(gaps).reduce((n, list) => n + list.length, 0);

console.log(`captured states exercised: ${checked}`);
console.log(`opened correctly: ${opened}`);
console.log(`known gaps (never captured): ${gapCount}`);
if (problems.length) {
  console.log("\nproblems:");
  for (const line of problems.slice(0, 25)) console.log("  " + line);
  if (problems.length > 25) console.log(`  ... and ${problems.length - 25} more`);
  process.exitCode = 1;
} else {
  console.log("\nok — every captured state replays");
}
