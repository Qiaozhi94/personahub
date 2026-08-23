#!/usr/bin/env node
/**
 * Phase 1 — truth extraction.
 *
 * Captures, from a running application, everything needed to reproduce a page
 * exactly: the rendered DOM, per-element computed styles, resolved CSS custom
 * properties, a screenshot for human review, and the compiled stylesheets.
 *
 * The compiled stylesheets are the point. With them the replica needs no
 * hand-written CSS at all, which is what separates this from redrawing a page
 * by eye.
 *
 * Usage:
 *   node extract.mjs <project> [page]      # one page, or all pages if omitted
 *
 * Requires: npm i -D playwright && npx playwright install chromium
 */

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  FREEZE_CSS,
  LAUNCH_OPTIONS,
  NON_RENDERED_TAGS,
  STYLE_PROPS,
  assetsDir,
  pageConfig,
  projectConfig,
  truthDir,
} from "./config.mjs";
import { writeGzipText } from "./compressed-artifact.mjs";

const [, , projectSlug, pageArg] = process.argv;

if (!projectSlug) {
  console.error("usage: node extract.mjs <project> [page]");
  process.exit(1);
}

const project = projectConfig(projectSlug);
const pages = pageArg ? [pageConfig(project, pageArg)] : project.pages;

/**
 * Runs in the browser. Returns the rendered DOM plus a style snapshot keyed by
 * childIndex path.
 *
 * Node paths look like "0/2/1/3" — the chain of child indices from the capture
 * root. CSS selectors were the obvious alternative but they fail badly here:
 * one changed class invalidates every selector below it, so a small structural
 * drift reports as a total mismatch. Index paths degrade gracefully and point
 * at exactly which child is wrong.
 */
function captureInPage({ styleProps, skipTags, ignoreStyles }) {
  const root = document.documentElement;
  const skip = new Set(skipTags);

  // Resolve the configured selectors once, then look elements up by identity
  // during the walk. Matching per node would re-run every selector thousands
  // of times on a large page.
  const ignoreByElement = new Map();
  for (const rule of ignoreStyles ?? []) {
    for (const el of document.querySelectorAll(rule.selector)) {
      const existing = ignoreByElement.get(el) ?? new Set();
      for (const prop of rule.props) existing.add(prop);
      ignoreByElement.set(el, existing);
    }
  }
  /** @type {Record<string, string[]>} */
  const ignored = {};

  /** @type {Record<string, Record<string, string>>} */
  const styles = {};
  /** @type {Record<string, string>} */
  const tags = {};
  /** @type {Record<string, number[]>} */
  const rects = {};

  // Chat views autoscroll to the latest message at load; the static replica
  // always starts at scrollTop 0. Reset every scrollable so truth and replica
  // measure the same resting geometry.
  for (const el of document.querySelectorAll("*")) {
    if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  }
  window.scrollTo(0, 0);

  const walk = (node, pathParts) => {
    const key = pathParts.join("/") || "root";
    const computed = window.getComputedStyle(node);

    /** @type {Record<string, string>} */
    const entry = {};
    for (const prop of styleProps) {
      entry[prop] = computed.getPropertyValue(prop).trim();
    }
    styles[key] = entry;
    tags[key] = node.tagName.toLowerCase();

    const skipProps = ignoreByElement.get(node);
    if (skipProps) ignored[key] = [...skipProps];

    // Geometry relative to the parent box. This is the authority on layout:
    // `margin: auto` resolves to different computed values depending on when
    // the browser is asked, so an element can report margin 0 in one run and
    // 60px in another while sitting in exactly the same place. Position and
    // size settle the question that margin only hints at.
    const box = node.getBoundingClientRect();
    const parentBox = node.parentElement?.getBoundingClientRect();
    rects[key] = [
      Math.round(
        ((parentBox ? box.x - parentBox.x : box.x) + Number.EPSILON) * 100,
      ) / 100,
      Math.round(
        ((parentBox ? box.y - parentBox.y : box.y) + Number.EPSILON) * 100,
      ) / 100,
      Math.round((box.width + Number.EPSILON) * 100) / 100,
      Math.round((box.height + Number.EPSILON) * 100) / 100,
    ];

    // Index over rendered children only, so paths survive staticization.
    const children = Array.from(node.children).filter(
      (child) => !skip.has(child.tagName.toLowerCase()),
    );
    children.forEach((child, i) => walk(child, [...pathParts, String(i)]));
  };

  walk(root, []);

  // Resolved custom properties. Reading them off the root element gives the
  // computed value (OKLCH already resolved, var() chains already followed),
  // which is what a replica has to match — the authored value in the source
  // stylesheet is often an unresolved reference.
  /** @type {Record<string, string>} */
  const vars = {};
  const rootStyle = window.getComputedStyle(root);
  for (let i = 0; i < rootStyle.length; i += 1) {
    const prop = rootStyle[i];
    if (prop.startsWith("--")) {
      vars[prop] = rootStyle.getPropertyValue(prop).trim();
    }
  }
  // Some frameworks declare custom properties on body rather than :root.
  if (document.body) {
    const bodyStyle = window.getComputedStyle(document.body);
    for (let i = 0; i < bodyStyle.length; i += 1) {
      const prop = bodyStyle[i];
      if (prop.startsWith("--") && !(prop in vars)) {
        vars[prop] = bodyStyle.getPropertyValue(prop).trim();
      }
    }
  }

  // Stylesheet hrefs, so the caller knows which compiled CSS files to save.
  const sheets = Array.from(document.styleSheets)
    .map((sheet) => sheet.href)
    .filter((href) => typeof href === "string" && href.length > 0);

  // Inline <style> content, which Next.js and Vite both emit for critical CSS.
  const inlineStyles = Array.from(document.querySelectorAll("style")).map(
    (el) => el.textContent ?? "",
  );

  return {
    html: root.outerHTML,
    styles,
    tags,
    rects,
    ignored,
    vars,
    sheets,
    inlineStyles,
    title: document.title,
  };
}

/**
 * Waits until the DOM stops changing.
 *
 * networkidle and a content selector are both necessary but not sufficient:
 * anything that fetches after mount (a star count, a lazy section, a chart)
 * lands afterwards. Capturing before it settles makes the snapshot depend on
 * whether the response was cached, which shows up later as a nondeterministic
 * node count between otherwise identical runs.
 *
 * Waiting for structural quiescence covers all of those without needing a
 * per-page selector for each async widget.
 */
async function waitForQuiescence(
  page,
  { quietMs = 600, timeoutMs = 10000 } = {},
) {
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

/** Strips known-volatile nodes and normalises non-deterministic text. */
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
      // Drop focus before capturing. Pages that autofocus a control capture it
      // with its :focus-visible ring applied (outline goes from `none` to
      // `auto`), while the static replica has nothing focused — a difference
      // that looks like a styling bug but is only about which element happened
      // to be active at capture time.
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      // Freeze animations and transitions so the screenshot and the style
      // snapshot describe the same settled state.
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

/** Downloads each compiled stylesheet once, preserving its filename. */
async function saveStylesheets(context, hrefs, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  /** @type {Record<string, string>} */
  const saved = {};

  for (const href of hrefs) {
    let filename;
    try {
      filename = path.basename(new URL(href).pathname) || "style.css";
    } catch {
      continue;
    }
    const target = path.join(outDir, filename);
    if (saved[href]) continue;

    try {
      const response = await context.request.get(href);
      if (!response.ok()) {
        console.warn(`  ! stylesheet ${response.status()} ${href}`);
        continue;
      }
      await fs.writeFile(target, await response.body());
      saved[href] = filename;
      console.log(`  css ${filename}`);
    } catch (error) {
      console.warn(`  ! stylesheet failed ${href}: ${error.message}`);
    }
  }

  return saved;
}

/**
 * Downloads everything the saved stylesheets reference (fonts, background
 * images) and rewrites the urls to point at the local copies.
 *
 * Skipping this is the most common reason a replica looks "almost right":
 * @font-face src urls keep resolving against the source origin, so once the
 * app stops they 404, text silently falls back to a system font, and every
 * text-sized box drifts a few pixels. The diff reports it as dozens of width
 * differences with no obvious cause.
 */
async function localizeCssAssets(context, baseUrl, outDir) {
  const mediaDir = path.join(outDir, "media");
  await fs.mkdir(mediaDir, { recursive: true });

  const sheets = (await fs.readdir(outDir)).filter((f) => f.endsWith(".css"));
  /** @type {Map<string, string>} */
  const downloaded = new Map();
  let failures = 0;

  for (const sheet of sheets) {
    const file = path.join(outDir, sheet);
    let css = await fs.readFile(file, "utf8");
    // Only absolute references are candidates. Anything already relative has
    // been rewritten by a previous run — re-resolving it would concatenate it
    // onto the origin ("http://host" + "media/x.woff2") and corrupt the
    // stylesheet, so this pass has to stay idempotent.
    const urls = new Set(
      [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
        .map((m) => m[1].trim())
        .filter((u) => u && (u.startsWith("/") || u.startsWith("http"))),
    );

    for (const url of urls) {
      if (!downloaded.has(url)) {
        const absolute = url.startsWith("http") ? url : `${baseUrl}${url}`;
        const filename = path.basename(new URL(absolute).pathname);
        try {
          const response = await context.request.get(absolute);
          if (!response.ok()) throw new Error(String(response.status()));
          await fs.writeFile(
            path.join(mediaDir, filename),
            await response.body(),
          );
          downloaded.set(url, filename);
        } catch (error) {
          failures += 1;
          downloaded.set(url, null);
          console.warn(`  ! asset ${url}: ${error.message}`);
        }
      }
      const local = downloaded.get(url);
      if (local) {
        css = css.split(url).join(`media/${local}`);
      }
    }

    await fs.writeFile(file, css, "utf8");
  }

  const ok = [...downloaded.values()].filter(Boolean).length;
  console.log(
    `  assets ${ok} localized${failures ? `, ${failures} failed` : ""}`,
  );
}

async function main() {
  const browser = await chromium.launch(LAUNCH_OPTIONS);
  const cssMap = {};
  let captured = 0;

  try {
    // Pages split by auth state, because being logged in changes what a public
    // route renders: a marketing page or login screen typically redirects into
    // the app once a session exists, so capturing it from an authenticated
    // context silently records the wrong page. Mark such routes `anonymous`.
    const groups = [
      { authed: true, items: pages.filter((p) => p.anonymous !== true) },
      { authed: false, items: pages.filter((p) => p.anonymous === true) },
    ].filter((group) => group.items.length > 0);

    for (const viewport of project.viewports) {
      for (const theme of project.themes) {
        for (const group of groups) {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            colorScheme: theme.colorScheme ?? "light",
            deviceScaleFactor: 2,
            // A fixed locale and timezone keep dates and number formatting
            // identical between runs on different machines.
            locale: "zh-CN",
            timezoneId: "Asia/Shanghai",
            reducedMotion: "reduce",
          });

          if (group.authed && typeof project.login === "function") {
            await project.login(context);
          }

          const page = await context.newPage();

          for (const target of group.items) {
            const label = `${target.name} [${theme.name}/${viewport.name}]`;
            process.stdout.write(`→ ${label}\n`);

            const url = `${project.baseUrl}${target.url}`;
            const waitUntil = project.networkIdle === false ? "domcontentloaded" : "networkidle";
            await page.goto(url, { waitUntil });

            // Warm-up pass, then reload and capture the second render.
            //
            // A cold load races anything fetched after mount: if the response
            // lands after the quiet window closes, the capture misses it, and
            // the next run — now served from cache — includes it. That shows up
            // as a node count that changes between identical runs. No fixed
            // timeout fixes this, because the request can be arbitrarily slow.
            // Reloading makes every capture a warm one, which is reproducible.
            if (target.warmup !== false) {
              if (target.waitFor) {
                await page
                  .waitForSelector(target.waitFor, { state: "visible" })
                  .catch(() => {});
              }
              await page.reload({ waitUntil });
            }

            if (theme.apply) await page.evaluate(theme.apply);
            // Views that live behind a click (SPA tabs, modals, conversation
            // items) select themselves here, after the warmup reload reset the
            // app to its default state.
            if (target.prepare) await target.prepare(page, project);
            if (target.waitFor) {
              await page.waitForSelector(target.waitFor, { state: "visible" });
            }
            if (project.networkIdle !== false) {
              await page.waitForLoadState("networkidle");
            }
            await waitForQuiescence(page, {
              quietMs: target.quietMs ?? 600,
              timeoutMs: target.settleTimeoutMs ?? 10000,
            });
            // Two frames after the theme flip so class-driven variables settle.
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
            );

            await stabilize(page, project);

            const result = await page.evaluate(captureInPage, {
              styleProps: STYLE_PROPS,
              skipTags: NON_RENDERED_TAGS,
              ignoreStyles: project.ignoreStyles ?? [],
            });
            const dir = truthDir(
              projectSlug,
              target.name,
              theme.name,
              viewport.name,
            );
            await fs.mkdir(dir, { recursive: true });

            await writeGzipText(path.join(dir, "dom.html"), result.html);
            await writeGzipText(
              path.join(dir, "styles.json"),
              JSON.stringify(
                {
                  tags: result.tags,
                  rects: result.rects,
                  ignored: result.ignored,
                  styles: result.styles,
                },
                null,
                2,
              ),
            );
            await writeGzipText(
              path.join(dir, "vars.json"),
              JSON.stringify(result.vars, null, 2),
            );
            await writeGzipText(
              path.join(dir, "inline-styles.css"),
              result.inlineStyles.join("\n\n/* --- */\n\n"),
            );
            await writeGzipText(
              path.join(dir, "meta.json"),
              JSON.stringify(
                {
                  project: projectSlug,
                  page: target.name,
                  url: target.url,
                  theme: theme.name,
                  viewport,
                  title: result.title,
                  sheets: result.sheets,
                  capturedAt: new Date().toISOString(),
                  nodeCount: Object.keys(result.styles).length,
                },
                null,
                2,
              ),
            );
            await page.screenshot({
              path: path.join(dir, "shot.png"),
              fullPage: true,
            });

            Object.assign(
              cssMap,
              await saveStylesheets(
                context,
                result.sheets,
                assetsDir(projectSlug),
              ),
            );

            console.log(
              `  ok ${Object.keys(result.styles).length} nodes, ` +
                `${Object.keys(result.vars).length} css vars`,
            );
            captured += 1;
          }

          await context.close();
        }
      }
    }

    await fs.writeFile(
      path.join(assetsDir(projectSlug), "css-map.json"),
      JSON.stringify(cssMap, null, 2),
      "utf8",
    );

    // Runs after every sheet is on disk, so each referenced asset is fetched
    // once rather than once per page.
    console.log("\n→ localizing css assets");
    const assetContext = await browser.newContext();
    try {
      await localizeCssAssets(
        assetContext,
        project.baseUrl,
        assetsDir(projectSlug),
      );
    } finally {
      await assetContext.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\ndone: ${captured} captures`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
