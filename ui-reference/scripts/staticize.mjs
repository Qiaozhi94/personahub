#!/usr/bin/env node
/**
 * Phase 2 — staticization.
 *
 * Turns each captured DOM into a standalone HTML file that opens from disk and
 * looks identical to the original.
 *
 * This step only removes things. It never rewrites CSS, renames classes, or
 * reconstructs design tokens — the captured markup already carries the exact
 * class strings, and the saved compiled stylesheets already carry the exact
 * values. Editing either one is how a replica starts drifting.
 *
 * Usage:
 *   node staticize.mjs <project> [page]
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import {
  OUT_ROOT,
  assetsDir,
  pageConfig,
  pagesDir,
  projectConfig,
  truthDir,
} from "./config.mjs";
import { readTextArtifact } from "./compressed-artifact.mjs";

const [, , projectSlug, pageArg] = process.argv;

if (!projectSlug) {
  console.error("usage: node staticize.mjs <project> [page]");
  process.exit(1);
}

const project = projectConfig(projectSlug);
const targets = pageArg ? [pageConfig(project, pageArg)] : project.pages;

/**
 * Framework runtime payloads. These are inert once the DOM is frozen, but they
 * are large, they leak absolute URLs and auth state, and Next.js in particular
 * will try to hydrate and blank the page if its scripts run.
 */
const STRIP_PATTERNS = [
  // Next.js
  /<script[^>]*id="__NEXT_DATA__"[\s\S]*?<\/script>/gi,
  /<script[^>]*src="[^"]*\/_next\/static\/[^"]*"[^>]*><\/script>/gi,
  /<script[^>]*>\s*self\.__next_f[\s\S]*?<\/script>/gi,
  /<script[^>]*>\s*\(self\.__next_s[\s\S]*?<\/script>/gi,
  // Vite entry points — the module script would re-render the app and wipe
  // the frozen #root. modulepreload links stay when the project opts in
  // (keepModulepreload): they are inert without the entry script and keep
  // the head structure identical for the DOM diff.
  /<script[^>]*type="module"[^>]*><\/script>/gi,
  /<link[^>]*rel="modulepreload"[^>]*>/gi,
  // Vite SPA boot payloads (DeepSeek Harness etc.): inert plugin manifests
  // that leak internal URLs once the DOM is frozen
  /<script>window\.__DSH_BOOT__[\s\S]*?<\/script>/gi,
  // Generic bundler entry points
  /<script[^>]*src="[^"]*\/(?:assets|static|_app)\/[^"]*\.js"[^>]*><\/script>/gi,
  // Dev overlays that survive removeSelectors when injected late
  /<nextjs-portal[\s\S]*?<\/nextjs-portal>/gi,
  // Our own freeze style — the static page re-adds its own copy
  /<style[^>]*data-replication-freeze[^>]*>[\s\S]*?<\/style>/gi,
];

/**
 * Removes `autofocus`, which the browser acts on the moment the replica loads.
 *
 * The capture blurs before snapshotting, so the truth records the control in
 * its resting state. Left in the markup, the replica focuses it instead and
 * paints a focus ring — reported as differing border colors, box-shadow and
 * outline on that one node. Dropping the attribute also stops an archived page
 * from grabbing focus for no reason when someone opens it.
 */
function stripAutofocus(html) {
  return html.replace(/\sautofocus(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?/gi, "");
}

/** Maps a captured page name to its output filename. */
function htmlName(pageName) {
  return `${pageName}.html`;
}

/**
 * Resolves an in-app route to a captured page name.
 *
 * Exact URLs win. Everything else falls through to `routes.patterns`, which
 * exists because a reference archive holds one detail page per entity type,
 * not one per entity: `/ws/projects/<any-uuid>` all resolve to the single
 * project detail capture. Routing by entity type rather than identity is the
 * whole reason the archive stays navigable without a backend.
 *
 * Pattern order matters — put literal segments (`/agents/new`) before the
 * id-shaped catch-all (`/agents/:id`) or the catch-all swallows them.
 */
function makeRouteResolver(project) {
  const exact = new Map(project.pages.map((p) => [p.url, p.name]));
  const patterns = (project.routes?.patterns ?? []).map(([source, name]) => [
    new RegExp(source),
    name,
  ]);
  const captured = new Set(project.pages.map((p) => p.name));

  return (urlPath) => {
    const hit = exact.get(urlPath);
    if (hit) return hit;
    for (const [pattern, name] of patterns) {
      if (pattern.test(urlPath)) return captured.has(name) ? name : null;
    }
    return null;
  };
}

/**
 * Rewrites in-app navigation to sibling HTML files. Anything without a
 * configured counterpart becomes inert rather than pointing at localhost,
 * so the archive never depends on the source app still running.
 */
function rewriteLinks(html, resolve) {
  return html.replace(
    /href="(\/[^"#?]*)((?:[?#][^"]*)?)"/g,
    (_match, urlPath, suffix) => {
      const name = resolve(urlPath);
      if (name) return `href="${htmlName(name)}${suffix}"`;
      // Unmapped internal route: keep it visible but non-navigating.
      return `href="#" data-original-href="${urlPath}${suffix}"`;
    },
  );
}

/** Points stylesheet links at the locally saved compiled CSS. */
function rewriteStylesheets(html, cssMap) {
  return html.replace(
    /<link([^>]*?)href="([^"]+)"([^>]*?)>/gi,
    (match, before, href, after) => {
      if (!/rel=["']?stylesheet/i.test(match)) return match;
      const filename = cssMap[href] ?? path.basename(href.split("?")[0]);
      if (!filename) return match;
      return `<link${before}href="../assets/${filename}"${after}>`;
    },
  );
}

/**
 * Absolute asset URLs pointing back at the source origin. Images left this way
 * silently 404 once the app stops, so they are flagged rather than kept.
 */
function reportRemoteAssets(html, baseUrl) {
  const found = new Set();
  const pattern = new RegExp(
    `(?:src|href)="(${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*)"`,
    "g",
  );
  let match;
  while ((match = pattern.exec(html)) !== null) found.add(match[1]);
  return [...found];
}

/**
 * The replica's own interaction layer.
 *
 * Tagged with data-replica-runtime so diff-dom.mjs can tell it apart from the
 * captured markup — without the marker every page reports one spurious "extra
 * node" finding, which trains you to ignore the report.
 */
function runtimeTag(pageName, project, states) {
  const config = {
    page: pageName,
    clickNav: (project.routes?.clickNav ?? [])
      .filter((rule) => rule.page === pageName)
      .map((rule) => ({ selector: rule.selector, to: htmlName(rule.to) })),
    states: states ?? {},
  };
  // JSON inside a <script> has to survive the HTML parser: only "</" can end
  // the element early, so that is the one sequence worth escaping.
  const json = JSON.stringify(config).replace(/<\//g, "<\\/");
  // Per-project supplement (scripts/runtime/replica-<slug>.js) for behaviors
  // the generic engine cannot express declaratively — text-keyed rows, tabs
  // that navigate between pages instead of swapping panels.
  const supplement = `replica-${projectSlug}.js`;
  const supplementTag = fsSync.existsSync(path.join(RUNTIME_SOURCE, supplement))
    ? `\n<script src="../assets/${supplement}" defer data-replica-runtime></script>`
    : "";
  return `
<link rel="stylesheet" href="../assets/replica.css" data-replica-runtime>
<script data-replica-runtime>window.__REPLICA__=${json};</script>
<script src="../assets/replica.js" defer data-replica-runtime></script>${supplementTag}
`;
}

/**
 * The runtime is copied from scripts/runtime/ on every run rather than seeded
 * once. It carries no project-specific behavior — everything variable reaches
 * it through window.__REPLICA__ — so overwriting it propagates fixes to every
 * archive instead of leaving each one pinned to the version it was born with.
 */
const RUNTIME_SOURCE = path.join(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "runtime",
);

/**
 * Overlay and tab-panel states recorded by capture-states.mjs, keyed by the
 * trigger's childIndex path. Missing means those interactions were never
 * captured — the page still navigates, it just cannot open menus.
 */
async function loadStates(pageName) {
  const file = path.join(OUT_ROOT, projectSlug, "states", `${pageName}.json`);
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return {};
  }
}

async function processPage(target, cssMap) {
  const theme = project.themes[0];
  const viewport = project.viewports[0];
  const dir = truthDir(projectSlug, target.name, theme.name, viewport.name);

  let html;
  try {
    html = await readTextArtifact(path.join(dir, "dom.html"));
  } catch {
    console.warn(`  ! no capture for ${target.name}, run extract.mjs first`);
    return null;
  }

  for (const pattern of STRIP_PATTERNS) {
    if (project.keepModulepreload && pattern.source.includes("modulepreload")) {
      continue;
    }
    html = html.replace(pattern, "");
  }

  html = stripAutofocus(html);
  html = rewriteStylesheets(html, cssMap);
  html = rewriteLinks(html, makeRouteResolver(project));
  if (typeof project.postProcess === "function") {
    html = project.postProcess(html);
  }

  // modulepreload links are kept only for DOM-diff parity (keepModulepreload).
  // Chromium CORS-blocks modulepreload fetches on file://, so the href is a
  // data: URI — exempt and inert. Without the module entry script nothing
  // ever consumes the preload.
  if (project.keepModulepreload) {
    html = html.replace(
      /<link([^>]*?)rel="modulepreload"([^>]*?)>/gi,
      (_match, before, after) => {
        const clean = `${before}${after}`.replace(/\sdata-original-href="[^"]*"/g, "");
        return `<link${clean} href="data:application/javascript,">`;
      },
    );
  }

  // Favicon pointing at the source origin goes local when a copy exists in
  // assets/ (downloaded during asset localization).
  html = html.replace(
    /<link([^>]*?)rel="icon"([^>]*?)href="#"([^>]*?)data-original-href="\/favicon\.svg"([^>]*?)>/gi,
    (_match, before, after, rest, tail) => {
      if (fsSync.existsSync(path.join(assetsDir(projectSlug), "favicon.svg"))) {
        return `<link${before}rel="icon"${after}href="../assets/favicon.svg"${rest}${tail}>`;
      }
      return _match;
    },
  );

  // Some archives target double-click opening. Chromium blocks <link
  // rel=stylesheet> pointing at file:// paths (CORS), so the compiled CSS is
  // served as data: URIs instead — same bytes, still zero hand-written
  // styles, and the <link> tag structure stays identical for the diff.
  if (project.inlineCss) {
    for (const match of html.matchAll(/<link([^>]*?)href="(\.\.\/assets\/[^"]+\.css)"([^>]*?)>/gi)) {
      const file = path.join(assetsDir(projectSlug), path.basename(match[2]));
      try {
        const css = await fs.readFile(file, "utf8");
        // A data: URI stylesheet has no base URL: relative url() references
        // resolve against the document (pages/), so media/ must become
        // ../assets/media/ to keep the localized fonts reachable.
        const rebased = css.replace(
          /url\(("|')?media\//g,
          "url($1../assets/media/",
        );
        const uri = `data:text/css;base64,${Buffer.from(rebased).toString("base64")}`;
        html = html.replace(match[0], `<link${match[1]}href="${uri}"${match[3]}>`);
      } catch {
        /* keep the link if the file is missing */
      }
    }
  }

  const remote = reportRemoteAssets(html, project.baseUrl);

  // The capture starts at <html>, so the doctype has to come back.
  html = `<!doctype html>\n${html}`;
  html = html.replace(
    "</head>",
    `${runtimeTag(target.name, project, await loadStates(target.name))}</head>`,
  );

  const outDir = pagesDir(projectSlug);
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, htmlName(target.name));
  await fs.writeFile(outFile, html, "utf8");

  return { file: outFile, remote, bytes: Buffer.byteLength(html) };
}

async function main() {
  let cssMap = {};
  try {
    cssMap = JSON.parse(
      await fs.readFile(path.join(assetsDir(projectSlug), "css-map.json"), "utf8"),
    );
  } catch {
    console.warn("! css-map.json missing; falling back to basename matching");
  }

  const assets = assetsDir(projectSlug);
  await fs.mkdir(assets, { recursive: true });
  const runtimeFiles = ["replica.css", "replica.js"];
  const supplement = `replica-${projectSlug}.js`;
  if (fsSync.existsSync(path.join(RUNTIME_SOURCE, supplement))) {
    runtimeFiles.push(supplement);
  }
  for (const file of runtimeFiles) {
    await fs.copyFile(
      path.join(RUNTIME_SOURCE, file),
      path.join(assets, file),
    );
  }

  const remoteAll = new Set();
  let written = 0;

  for (const target of targets) {
    process.stdout.write(`→ ${target.name}\n`);
    const result = await processPage(target, cssMap);
    if (!result) continue;
    written += 1;
    for (const url of result.remote) remoteAll.add(url);
    console.log(`  ok ${(result.bytes / 1024).toFixed(0)} KB`);
  }

  if (remoteAll.size > 0) {
    console.log(
      `\n! ${remoteAll.size} asset(s) still point at the source origin.\n` +
        "  They will break once the source app stops. Download them into\n" +
        "  assets/ and rewrite the references, or inline them as data URIs:",
    );
    for (const url of [...remoteAll].slice(0, 10)) console.log(`    ${url}`);
    if (remoteAll.size > 10) console.log(`    ... and ${remoteAll.size - 10} more`);
  }

  console.log(`\ndone: ${written} page(s) written to ${pagesDir(projectSlug)}`);
  console.log(
    "next: open one in a browser side by side with the real page.\n" +
      "If it differs, a stylesheet or font is missing — go find it.\n" +
      "Do not fix it by editing CSS.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
