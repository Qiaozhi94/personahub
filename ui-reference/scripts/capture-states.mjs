#!/usr/bin/env node
/**
 * Phase 3 — interaction state capture.
 *
 * Menus, popovers, dialogs, tooltips and inactive tab panels are not in the
 * captured page. Radix (and every headless UI library built the same way)
 * mounts them on open and unmounts them on close, so a frozen page holds only
 * the closed state. That is why a static replica can look perfect and still do
 * nothing when clicked.
 *
 * This script drives the running app the way a user would — click, hover,
 * right-click — and records the exact nodes each interaction adds to the
 * document. replica.js replays them. Nothing is authored by hand, which is the
 * same discipline the DOM and CSS capture follow.
 *
 * Output: ui-reference/<project>/states/<page>.json, keyed by the trigger's
 * childIndex path so the runtime can look a state up from a clicked element
 * without depending on selectors.
 *
 * Usage:
 *   node capture-states.mjs <project> [page]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  FREEZE_CSS,
  LAUNCH_OPTIONS,
  NON_RENDERED_TAGS,
  OUT_ROOT,
  pageConfig,
  projectConfig,
} from "./config.mjs";

const [, , projectSlug, pageArg] = process.argv;

if (!projectSlug) {
  console.error("usage: node capture-states.mjs <project> [page]");
  process.exit(1);
}

const project = projectConfig(projectSlug);
const pages = pageArg ? [pageConfig(project, pageArg)] : project.pages;

/**
 * What counts as a trigger, and how each kind is opened.
 *
 * Driven off the accessibility attributes and the component library's own
 * `data-slot` names rather than a per-project list: both are part of the
 * rendered markup, so this survives a redesign that renames every class.
 */
const TRIGGERS = [
  { match: '[data-slot="tooltip-trigger"]', kind: "tooltip", action: "hover" },
  { match: '[data-slot="hover-card-trigger"]', kind: "hovercard", action: "hover" },
  { match: '[data-slot="context-menu-trigger"]', kind: "contextmenu", action: "contextmenu" },
  { match: '[role="tab"]', kind: "tab", action: "click" },
  { match: '[aria-haspopup="menu"]', kind: "menu", action: "click" },
  { match: '[aria-haspopup="dialog"]', kind: "dialog", action: "click" },
  { match: '[aria-haspopup="listbox"]', kind: "listbox", action: "click" },
  { match: '[data-slot$="-trigger"][aria-expanded]', kind: "menu", action: "click" },
];

/** Mirrors the childIndex addressing used by extract.mjs and replica.js. */
function pathHelpers() {
  return {
    nodePath: (el, skipTags) => {
      const skip = new Set(skipTags);
      const parts = [];
      while (el && el !== document.documentElement) {
        const parent = el.parentElement;
        if (!parent) return null;
        let index = 0;
        let found = -1;
        for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
          if (skip.has(c.tagName.toLowerCase())) continue;
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
    },
  };
}

async function waitForQuiescence(page, { quietMs = 500, timeoutMs = 8000 } = {}) {
  await page.evaluate(
    ({ quietMs, timeoutMs }) =>
      new Promise((resolve) => {
        let timer;
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(finish, quietMs);
        });
        const finish = () => {
          observer.disconnect();
          clearTimeout(timer);
          clearTimeout(cap);
          resolve();
        };
        const cap = setTimeout(finish, timeoutMs);
        timer = setTimeout(finish, quietMs);
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
      }),
    { quietMs, timeoutMs },
  );
}

/**
 * Same stabilization the DOM capture applies, and it has to be the same or the
 * paths recorded here address a different tree than the one in the static page.
 */
async function stabilize(page, config) {
  await page.evaluate(
    ({ removeSelectors, volatileText, freezeCss }) => {
      for (const selector of removeSelectors ?? []) {
        for (const el of document.querySelectorAll(selector)) el.remove();
      }
      for (const rule of volatileText ?? []) {
        for (const el of document.querySelectorAll(rule.selector)) {
          el.textContent = rule.text;
        }
      }
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const style = document.createElement("style");
      style.setAttribute("data-replication-freeze", "");
      style.textContent = freezeCss;
      document.head.appendChild(style);
    },
    {
      removeSelectors: config.removeSelectors ?? [],
      volatileText: config.volatileText ?? [],
      freezeCss: FREEZE_CSS,
    },
  );
}

/** Every trigger on the page, in document order, addressed by path. */
async function findTriggers(page) {
  return page.evaluate(
    ({ triggers, skipTags, helpers }) => {
      const { nodePath } = new Function(`return (${helpers})()`)();
      const seen = new Map();
      for (const spec of triggers) {
        for (const el of document.querySelectorAll(spec.match)) {
          const key = nodePath(el, skipTags);
          if (!key || seen.has(key)) continue; // first spec wins
          seen.set(key, {
            path: key,
            kind: spec.kind,
            action: spec.action,
            label: (el.getAttribute("aria-label") || el.textContent || "")
              .trim()
              .slice(0, 40),
          });
        }
      }
      return [...seen.values()];
    },
    { triggers: TRIGGERS, skipTags: NON_RENDERED_TAGS, helpers: pathHelpers.toString() },
  );
}

/** Locates a trigger by path, so a stale element handle never leaks state. */
function locate(page, targetPath) {
  return page.evaluateHandle(
    ({ targetPath, skipTags, helpers }) => {
      const { nodePath } = new Function(`return (${helpers})()`)();
      const all = document.querySelectorAll("*");
      for (const el of all) {
        if (nodePath(el, skipTags) === targetPath) return el;
      }
      return null;
    },
    { targetPath, skipTags: NON_RENDERED_TAGS, helpers: pathHelpers.toString() },
  );
}

/**
 * Centers an element in whichever ancestor actually scrolls.
 *
 * `scrollIntoView` walks to the *nearest* scrollable ancestor, and in a modern
 * app layout that is often a collapsed wrapper — measured here at 23px tall —
 * which absorbs the call and leaves the element exactly where it was. Skipping
 * ancestors whose content does not overflow finds the real scroller instead.
 */
const SCROLL_INTO_CENTER = (el) => {
  let node = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (
      /(auto|scroll)/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight + 8
    ) {
      const target = el.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      node.scrollTop +=
        target.top - box.top - (node.clientHeight - target.height) / 2;
      return;
    }
    node = node.parentElement;
  }
  el.scrollIntoView({ block: "center", inline: "center" });
};

/**
 * Hovers ancestors until a hover-revealed control becomes visible.
 *
 * Walks upward rather than guessing which ancestor owns the `group-hover`
 * rule: the rule can live several levels up and the class names differ per
 * component, but hovering each level in turn finds it without knowing any of
 * that. Stops at the first hover that makes the target visible.
 */
async function revealElement(page, element) {
  const isVisible = () =>
    element.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity) > 0.01 &&
        rect.width > 0 &&
        rect.height > 0
      );
    });

  if (await isVisible()) return;

  for (let level = 1; level <= 6; level += 1) {
    const ancestor = await element.evaluateHandle((el, depth) => {
      let node = el;
      for (let i = 0; i < depth && node.parentElement; i += 1) node = node.parentElement;
      return node;
    }, level);
    const handle = ancestor.asElement();
    if (!handle) break;
    await handle.evaluate(SCROLL_INTO_CENTER).catch(() => {});
    await handle.hover({ timeout: 1000, force: true }).catch(() => {});
    await handle.dispose();
    await page.waitForTimeout(80);
    if (await isVisible()) return;
  }
}

const BODY_ATTRS = ["style", "data-scroll-locked", "data-aria-hidden", "aria-hidden"];

async function snapshotBody(page) {
  return page.evaluate(
    (attrs) => ({
      children: document.body.children.length,
      attrs: Object.fromEntries(
        attrs.map((a) => [a, document.body.getAttribute(a)]),
      ),
    }),
    BODY_ATTRS,
  );
}

/**
 * Nodes the interaction added to <body>, plus the body attributes it changed.
 *
 * Portals append to <body>, and the popper wrapper carries the resolved
 * position in an inline transform — so replaying the outerHTML reproduces both
 * the content and where it sits, with no positioning logic in the runtime.
 */
async function captureAddition(page, before) {
  return page.evaluate(
    ({ beforeCount, attrs, beforeAttrs }) => {
      const added = [...document.body.children].slice(beforeCount);
      if (added.length === 0) return null;
      const body = {};
      for (const a of attrs) {
        const now = document.body.getAttribute(a);
        if (now !== null && now !== beforeAttrs[a]) body[a] = now;
      }
      return { html: added.map((el) => el.outerHTML).join(""), body };
    },
    { beforeCount: before.children, attrs: BODY_ATTRS, beforeAttrs: before.attrs },
  );
}

/** The active tab panel, for tab triggers where the panel is inline, not portalled. */
async function captureTabPanel(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[role="tabpanel"]');
    return panel ? { html: panel.outerHTML, body: {} } : null;
  });
}

async function capturePage(context, target, theme) {
  const page = await context.newPage();
  const url = `${project.baseUrl}${target.url}`;
  const waitUntil = project.networkIdle === false ? "domcontentloaded" : "networkidle";

  const load = async () => {
    await page.goto(url, { waitUntil });
    if (target.waitFor) {
      await page.waitForSelector(target.waitFor, { state: "visible" }).catch(() => {});
    }
    await page.reload({ waitUntil });
    if (target.waitFor) {
      await page.waitForSelector(target.waitFor, { state: "visible" }).catch(() => {});
    }
    if (theme.apply) await page.evaluate(theme.apply);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    await waitForQuiescence(page);
    await stabilize(page, project);
  };

  await load();

  // Product-specific setup before discovery: some controls only exist after a
  // step this script cannot infer — a collapsed comment editor has to be
  // opened before its toolbar exists as anything but a hidden 23px stub. Each
  // entry is a selector to click, in order.
  for (const selector of target.preSteps ?? []) {
    await page.locator(selector).first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  const triggers = await findTriggers(page);
  const states = {};
  const failed = [];

  for (const trigger of triggers) {
    const before = await snapshotBody(page);
    const handle = await locate(page, trigger.path);
    const element = handle.asElement();
    if (!element) {
      failed.push(`${trigger.kind} ${JSON.stringify(trigger.label)}: element gone`);
      continue;
    }

    try {
      // Below-the-fold triggers cannot be hovered or clicked where they sit.
      // Scrolling is safe here: the positioner these components emit is
      // `position: absolute` with a document-space transform, so an overlay
      // captured while scrolled replays correctly at any scroll offset.
      // Uses the DOM call rather than Playwright's actionability-aware helper:
      // that one refuses to scroll an element it considers non-interactable,
      // which is exactly the hover-revealed case this has to reach.
      await element.evaluate(SCROLL_INTO_CENTER).catch(() => {});
      await page.waitForTimeout(80);

      // Controls that only exist on hover — comment toolbars, row actions —
      // report as hidden until an ancestor is hovered. The CSS that reveals
      // them is already in the archive, so only their overlay content is
      // missing; hovering the way a user would is what makes it reachable.
      await revealElement(page, element);

      if (trigger.action === "hover") {
        await element.hover({ timeout: 2000, force: true });
      } else if (trigger.action === "contextmenu") {
        await element.click({ button: "right", timeout: 2000, force: true });
      } else {
        await element.click({ timeout: 2000, force: true });
      }

      // Tooltips and hover cards open on a delay by design, and the delay is a
      // product decision, not a bug — polling until the portal appears keeps
      // the capture correct without hard-coding anyone's timing.
      const budget = trigger.action === "hover" ? 1600 : 700;
      const deadline = Date.now() + budget;
      let captured = null;
      do {
        await page.waitForTimeout(150);
        captured =
          trigger.kind === "tab"
            ? await captureTabPanel(page)
            : await captureAddition(page, before);
      } while (!captured && Date.now() < deadline);

      if (captured) {
        states[trigger.path] = {
          kind: trigger.kind,
          label: trigger.label,
          html: captured.html,
          body: captured.body,
        };
      }
    } catch (error) {
      failed.push(`${trigger.kind} ${JSON.stringify(trigger.label)}: ${error.message.split("\n")[0]}`);
    } finally {
      await handle.dispose();
    }

    // Close, then confirm. An overlay left open contaminates every state
    // captured after it, so a page that will not settle is reloaded rather
    // than trusted — cheaper than debugging a poisoned capture later.
    await page.keyboard.press("Escape").catch(() => {});
    await page.mouse.move(2, 2).catch(() => {});
    await page.waitForTimeout(120);
    const after = await snapshotBody(page);
    if (after.children !== before.children) {
      await load();
    }
  }

  await page.close();
  return { states, triggers: triggers.length, failed };
}

async function main() {
  const browser = await chromium.launch(LAUNCH_OPTIONS);
  const viewport = project.viewports[0];
  const theme = project.themes[0];
  const outDir = path.join(OUT_ROOT, projectSlug, "states");
  await fs.mkdir(outDir, { recursive: true });
  // What the archive knowingly does not cover. Written to disk because an
  // undocumented gap is rediscovered as a bug by whoever reads the archive
  // next, while a listed one is a known limit.
  const gaps = {};

  try {
    const groups = [
      { authed: true, items: pages.filter((p) => p.anonymous !== true) },
      { authed: false, items: pages.filter((p) => p.anonymous === true) },
    ].filter((group) => group.items.length > 0);

    for (const group of groups) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme.colorScheme ?? "light",
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
        reducedMotion: "reduce",
      });
      if (group.authed && typeof project.login === "function") {
        await project.login(context);
      }

      for (const target of group.items) {
        process.stdout.write(`→ ${target.name}\n`);
        const started = Date.now();
        const { states, triggers, failed } = await capturePage(context, target, theme);
        await fs.writeFile(
          path.join(outDir, `${target.name}.json`),
          JSON.stringify(states, null, 2),
          "utf8",
        );
        console.log(
          `  ${Object.keys(states).length}/${triggers} states` +
            (failed.length ? `, ${failed.length} did not open` : "") +
            ` (${((Date.now() - started) / 1000).toFixed(1)}s)`,
        );
        // Named, not just counted: a trigger that never opens is either a
        // genuinely inert control or a gap in the capture, and only the label
        // tells you which.
        for (const line of failed.slice(0, 6)) console.log(`    - ${line}`);
        if (failed.length > 6) console.log(`    - ... and ${failed.length - 6} more`);
        if (failed.length) gaps[target.name] = failed;
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  await fs.writeFile(
    path.join(outDir, "_gaps.json"),
    JSON.stringify(gaps, null, 2),
    "utf8",
  );

  console.log(`\nstates written to ${outDir}`);
  console.log("next: node staticize.mjs " + projectSlug + " to embed them");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
