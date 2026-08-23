#!/usr/bin/env node
/**
 * Phase 4 — visual verification.
 *
 * Loads the replica in a real browser, captures the same whitelisted computed
 * styles the extractor captured, and reports every property whose value drifted
 * beyond tolerance.
 *
 * This is what makes "looks the same" checkable. A screenshot diff answers
 * whether something changed; this answers which property on which node, which
 * is what you need to fix it.
 *
 * Usage:
 *   node diff-style.mjs <project> <page> [--theme light] [--viewport desktop]
 *   node diff-style.mjs <project> <page> --replica path/to/replica.html
 *
 * Requires: npm i -D playwright
 * Exit code is 1 when differences are found.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import {
  FREEZE_CSS,
  LAUNCH_OPTIONS,
  NON_RENDERED_TAGS,
  PIXEL_TOLERANCE,
  STYLE_PROPS,
  pagesDir,
  projectConfig,
  truthDir,
} from "./config.mjs";
import { readTextArtifact } from "./compressed-artifact.mjs";

const args = process.argv.slice(2);
const [projectSlug, pageName] = args;

if (!projectSlug || !pageName) {
  console.error("usage: node diff-style.mjs <project> <page> [--theme t] [--viewport v] [--replica file]");
  process.exit(1);
}

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const project = projectConfig(projectSlug);
const themeName = flag("theme", project.themes[0].name);
const viewportName = flag("viewport", project.viewports[0].name);
const theme = project.themes.find((t) => t.name === themeName) ?? project.themes[0];
const viewport =
  project.viewports.find((v) => v.name === viewportName) ?? project.viewports[0];
const replicaPath = path.resolve(
  flag("replica", null) ?? path.join(pagesDir(projectSlug), `${pageName}.html`),
);

/** Same traversal as extract.mjs, so paths line up exactly. */
function captureStyles({ styleProps, skipTags }) {
  const skip = new Set(skipTags);
  const styles = {};
  const tags = {};
  const rects = {};

  const walk = (node, pathParts) => {
    const key = pathParts.join("/") || "root";
    const computed = window.getComputedStyle(node);
    const entry = {};
    for (const prop of styleProps) {
      entry[prop] = computed.getPropertyValue(prop).trim();
    }
    styles[key] = entry;
    tags[key] = node.tagName.toLowerCase();

    const box = node.getBoundingClientRect();
    const parentBox = node.parentElement?.getBoundingClientRect();
    rects[key] = [
      Math.round(((parentBox ? box.x - parentBox.x : box.x) + Number.EPSILON) * 100) / 100,
      Math.round(((parentBox ? box.y - parentBox.y : box.y) + Number.EPSILON) * 100) / 100,
      Math.round((box.width + Number.EPSILON) * 100) / 100,
      Math.round((box.height + Number.EPSILON) * 100) / 100,
    ];

    const children = Array.from(node.children).filter(
      (child) => !skip.has(child.tagName.toLowerCase()),
    );
    children.forEach((child, i) => walk(child, [...pathParts, String(i)]));
  };

  walk(document.documentElement, []);
  return { styles, tags, rects };
}

const NUMERIC = /^-?[\d.]+px$/;

/**
 * Whether two computed values are equivalent.
 *
 * Sub-pixel gaps come from layout rounding and flex distribution, not from a
 * design difference, so they are absorbed by tolerance. Everything else —
 * colors, shadows, font stacks — must match as a string, because the browser
 * has already normalised both sides into the same representation.
 */
function equivalent(expected, actual) {
  if (expected === actual) return true;
  if (NUMERIC.test(expected) && NUMERIC.test(actual)) {
    return Math.abs(parseFloat(expected) - parseFloat(actual)) <= PIXEL_TOLERANCE;
  }
  // Normalise whitespace inside multi-part values (shadows, font stacks).
  return expected.replace(/\s+/g, " ") === actual.replace(/\s+/g, " ");
}

/**
 * Box-model properties whose computed value is a means, not an end. When the
 * element lands in the same place at the same size, a different margin is a
 * different route to an identical result — most often `auto` margins, which
 * Chrome reports inconsistently as either 0px or the resolved value.
 */
const GEOMETRY_IMPLIED = new Set([
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "width",
  "height",
]);

function sameRect(a, b) {
  if (!a || !b) return false;
  return a.every((value, i) => Math.abs(value - b[i]) <= PIXEL_TOLERANCE);
}

/** Properties that only matter when the element actually paints them. */
function isIrrelevant(prop, styles, rectsMatch) {
  if (prop.startsWith("border-") && prop.endsWith("-color")) {
    const side = prop.slice("border-".length, -"-color".length);
    return parseFloat(styles[`border-${side}-width`] ?? "0") === 0;
  }
  if (prop === "outline") return styles.outline?.includes("0px");
  if (rectsMatch && GEOMETRY_IMPLIED.has(prop)) return true;
  return false;
}

async function main() {
  const dir = truthDir(projectSlug, pageName, themeName, viewportName);
  const truthFile = path.join(dir, "styles.json");

  let truth;
  try {
    truth = JSON.parse(await readTextArtifact(truthFile));
  } catch {
    console.error(`no capture at ${truthFile}`);
    console.error("run extract.mjs first");
    process.exit(1);
  }

  try {
    await fs.access(replicaPath);
  } catch {
    console.error(`replica not found: ${replicaPath}`);
    process.exit(1);
  }

  const browser = await chromium.launch(LAUNCH_OPTIONS);
  let actual;
  try {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: theme.colorScheme ?? "light",
      deviceScaleFactor: 2,
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(replicaPath).href, { waitUntil: "load" });
    if (theme.apply) await page.evaluate(theme.apply);

    // Must match the stabilization extract.mjs applied, or the comparison is
    // not like-for-like. Without killing transitions, any element carrying
    // `transition-colors` is sampled mid-interpolation and reports a different
    // color on every run — a moving target that looks like a real defect.
    await page.evaluate((freezeCss) => {
      // Same blur as the capture. The replica keeps any `autofocus` attribute,
      // so the browser focuses that control on load and paints a focus ring
      // the captured page does not have — the mirror image of the problem the
      // capture-side blur solves.
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const style = document.createElement("style");
      style.setAttribute("data-replica-runtime", "");
      style.textContent = freezeCss;
      document.head.appendChild(style);
    }, FREEZE_CSS);

    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    actual = await page.evaluate(captureStyles, {
      styleProps: STYLE_PROPS,
      skipTags: NON_RENDERED_TAGS,
    });
    await context.close();
  } finally {
    await browser.close();
  }

  /** @type {{path: string, tag: string, prop: string, expected: string, got: string}[]} */
  const findings = [];
  let missingNodes = 0;
  let comparedNodes = 0;
  let geometryDrift = 0;

  for (const [key, expectedStyles] of Object.entries(truth.styles)) {
    const actualStyles = actual.styles[key];
    if (!actualStyles) {
      missingNodes += 1;
      continue;
    }
    comparedNodes += 1;

    const rectsMatch = sameRect(truth.rects?.[key], actual.rects?.[key]);
    const ignoredHere = new Set(truth.ignored?.[key] ?? []);
    if (truth.rects?.[key] && !rectsMatch && ignoredHere.size === 0) {
      geometryDrift += 1;
    }

    for (const prop of STYLE_PROPS) {
      if (ignoredHere.has(prop)) continue;
      const expectedValue = expectedStyles[prop] ?? "";
      const actualValue = actualStyles[prop] ?? "";
      if (equivalent(expectedValue, actualValue)) continue;
      if (isIrrelevant(prop, expectedStyles, rectsMatch)) continue;

      findings.push({
        path: key,
        tag: truth.tags?.[key] ?? "?",
        prop,
        expected: expectedValue,
        got: actualValue,
      });
    }
  }

  const label = `${pageName} [${themeName}/${viewportName}]`;

  if (findings.length === 0 && missingNodes === 0) {
    console.log(
      `ok  ${label} — ${comparedNodes} nodes, all styles within tolerance` +
        (geometryDrift > 0 ? ` (${geometryDrift} node(s) shifted position)` : ""),
    );
    if (geometryDrift === 0) return;
    console.log(
      "\n! Styles match but geometry moved. Something outside the whitelist\n" +
        "  is affecting layout — check fonts, images without dimensions, or a\n" +
        "  scrollbar appearing on one side only.",
    );
    process.exit(1);
  }

  if (missingNodes > 0) {
    console.log(
      `!   ${missingNodes} node(s) present in source but absent from replica.\n` +
        "    Run diff-dom.mjs first — structural gaps make style comparison\n" +
        "    meaningless below the missing node.\n",
    );
  }

  if (findings.length > 0) {
    // Group by property: a token-level mistake shows up as one property wrong
    // across hundreds of nodes, and that is one fix, not hundreds.
    const byProp = new Map();
    for (const finding of findings) {
      if (!byProp.has(finding.prop)) byProp.set(finding.prop, []);
      byProp.get(finding.prop).push(finding);
    }
    const ranked = [...byProp.entries()].sort((a, b) => b[1].length - a[1].length);

    console.log(
      `FAIL ${label} — ${findings.length} style difference(s) ` +
        `across ${byProp.size} propert${byProp.size === 1 ? "y" : "ies"}\n`,
    );

    for (const [prop, items] of ranked.slice(0, 12)) {
      console.log(`  ${prop} — ${items.length} node(s)`);
      for (const item of items.slice(0, 3)) {
        console.log(`      ${item.path} <${item.tag}>`);
        console.log(`      expected ${item.expected}`);
        console.log(`      got      ${item.got}`);
      }
      if (items.length > 3) console.log(`      ... ${items.length - 3} more`);
      console.log("");
    }
    if (ranked.length > 12) {
      console.log(`  ... and ${ranked.length - 12} more properties`);
    }

    console.log(
      "A property wrong on many nodes is one token or one stylesheet, not many\n" +
        "bugs. Check the compiled CSS and vars.json before touching markup.",
    );
  }

  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
