/**
 * Shared configuration for the frontend-replication pipeline.
 *
 * Copy this file next to the other scripts and edit the CONFIG block for each
 * project. Everything else in the pipeline reads from here, so this should be
 * the only file that changes between projects.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Root of the tracked replication archive; override for disposable captures. */
export const OUT_ROOT = path.resolve(
  process.env.REPLICATION_OUT ?? path.join(SCRIPT_DIR, ".."),
);

/**
 * Per-project settings, keyed by the project slug used on the command line
 * (`node extract.mjs <project>`).
 */

const tokenCache = new Map();
export async function cachedToken(key, produce, { ttlMinutes = 30 } = {}) {
  if (tokenCache.has(key)) return tokenCache.get(key);
  const file = path.join(os.tmpdir(), `replication-token-${key}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - cached.at < ttlMinutes * 60000) {
      tokenCache.set(key, Promise.resolve(cached.token));
      return cached.token;
    }
  } catch {}
  const pending = (async () => {
    const token = await produce();
    try { fs.writeFileSync(file, JSON.stringify({ token, at: Date.now() }), "utf8"); } catch {}
    return token;
  })();
  tokenCache.set(key, pending);
  return pending;
}
const browserCandidates = [
  process.env.PLAYWRIGHT_EXECUTABLE,
  path.join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(
    process.env["PROGRAMFILES(X86)"] ?? "",
    "Microsoft",
    "Edge",
    "Application",
    "msedge.exe",
  ),
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

/** Prefer an explicit or system browser; otherwise let Playwright find its own. */
export const LAUNCH_OPTIONS = executablePath ? { executablePath } : {};
export const PROJECTS = {
  clowder: {
    // Electron shell loads this same URL (see desktop main.js FRONTEND_PORT).
    baseUrl: process.env.SOURCE_BASE_URL ?? "http://localhost:3003",

    // Staged deliberately: the dev/showcase routes render without seeded data,
    // so they prove the pipeline before anything depends on real threads.
    pages: [
      { name: "settings", url: "/settings", waitFor: "body" },
      // The settings section's own sub-navigation: every item is a query-param
      // view of /settings (?s=members|profiles|...). /settings without a query
      // already renders the members view (the captured settings page), so the
      // remaining 13 items are captured here.
      { name: "settings-profiles", url: "/settings?s=profiles", waitFor: "body" },
      { name: "settings-accounts", url: "/settings?s=accounts", waitFor: "body" },
      { name: "settings-im", url: "/settings?s=im", waitFor: "body" },
      { name: "settings-skills", url: "/settings?s=skills", waitFor: "body" },
      { name: "settings-mcp", url: "/settings?s=mcp", waitFor: "body" },
      { name: "settings-plugins", url: "/settings?s=plugins", waitFor: "body" },
      { name: "settings-marketplace", url: "/settings?s=marketplace", waitFor: "body" },
      { name: "settings-concierge", url: "/settings?s=concierge", waitFor: "body" },
      { name: "settings-voice", url: "/settings?s=voice", waitFor: "body" },
      { name: "settings-system", url: "/settings?s=system", waitFor: "body" },
      { name: "settings-rules", url: "/settings?s=rules", waitFor: "body" },
      { name: "settings-notify", url: "/settings?s=notify", waitFor: "body" },
      { name: "settings-ops", url: "/settings?s=ops", waitFor: "body" },
      { name: "memory", url: "/memory", waitFor: "body" },
      // The memory section's own sub-navigation. Capturing only the index left
      // every tab in its header pointing nowhere.
      { name: "memory-search", url: "/memory/search", waitFor: "body" },
      { name: "memory-status", url: "/memory/status", waitFor: "body" },
      { name: "memory-health", url: "/memory/health", waitFor: "body" },
      { name: "memory-catalog", url: "/memory/catalog", waitFor: "body" },
      { name: "memory-graph", url: "/memory/graph", waitFor: "body" },
      { name: "dev-overflow", url: "/dev/f269-overflow-preview", waitFor: "body" },
      { name: "showcase-f11", url: "/showcase/f11-review", waitFor: "body" },
      // The socket.io-driven page: the real test of whether continuous push
      // lets the DOM ever go quiet. (chat) is a route group, so it serves "/".
      { name: "chat", url: "/", waitFor: "body" },
      // Rail destinations: the 主导航 buttons link here from every page, so
      // without captures they dead-end.
      { name: "mission-hub", url: "/mission-hub", waitFor: "body" },
      { name: "signals", url: "/signals", waitFor: "body" },
      { name: "signals-sources", url: "/signals/sources", waitFor: "body" },
      // A seeded thread view (the sidebar's conversation rows navigate to
      // /thread/<id>). One capture stands in for every thread.
      {
        name: "thread",
        url: "/thread/thread_mrg14xgm9ayrxp5t",
        waitFor: "body",
      },
    ],

    // Tailwind v3 with darkMode: ['selector', '[data-theme="dark"]'].
    themes: [
      {
        name: "dark",
        colorScheme: "dark",
        apply: () => {
          document.documentElement.setAttribute("data-theme", "dark");
        },
      },
      {
        name: "light",
        colorScheme: "light",
        apply: () => {
          document.documentElement.setAttribute("data-theme", "light");
        },
      },
    ],

    viewports: [{ name: "desktop", width: 1440, height: 900 }],

    login: null,

    volatileText: [],

    removeSelectors: [
      "#__next-build-watcher",
      "nextjs-portal",
      "[data-nextjs-toast]",
      "[data-nextjs-dev-tools-button]",
      "next-route-announcer",
    ],

    // Canvas and terminal widgets paint outside the DOM, so their geometry is
    // not reproducible from markup. Compare everything else about them.
    ignoreStyles: [
      { selector: "canvas", props: ["width", "height", "transform"] },
      { selector: ".xterm, .xterm-screen", props: ["width", "height"] },
    ],

    /**
     * Navigation the archive has to reproduce without a router.
     *
     * The rail buttons (对话/记忆/Mission Hub/信号/设置/审批中心) and the chat
     * sidebar's thread rows are `<button>`/`<div>` elements — nothing in the
     * markup says where they go, so they are wired in the project supplement
     * (assets/replica-clowder.js) keyed off data-guide-id / data-thread-id.
     * Those do not appear here because verify-nav clicks at x=200 inside the
     * target, which is outside a 40px rail button — clickNav rules for them
     * would report constant false failures.
     *
     * `patterns` resolve id-bearing routes to the single capture of that
     * entity type — every /thread/<id> lands on the seeded thread view.
     */
    routes: {
      patterns: [["^/thread/[^/]+$", "thread"]],
    },

    /**
     * Runs on each staticized page after the pipeline rewrites, before write.
     * Localizes root-relative assets (avatars, concierge sprite) that only
     * exist on the source origin and are not caught by the generic CSS-asset
     * localizer because they are referenced from HTML, not stylesheets.
     */
    postProcess: (html) =>
      html.replace(
        /(src|href)="\/(avatars|concierge)\/[^"]*"/g,
        (match, attr) => {
          const file = match.match(/[^/"]+\.(?:webp|png|svg|jpg|jpeg|gif)"$/);
          if (!file) return match;
          return `${attr}="../assets/media/${file[0].replace(/"$/, "")}"`;
        },
      ),
  },

  multica: {
    baseUrl: process.env.SOURCE_BASE_URL ?? "http://localhost:3002",

    pages: [
      // Public routes redirect into the app once a session exists, so they
      // must be captured logged out.
      { name: "landing", url: "/", waitFor: "main h1", anonymous: true },
      { name: "login", url: "/login", waitFor: "form input", anonymous: true },
      { name: "about", url: "/about", waitFor: "main h1", anonymous: true },
      // Reached from the landing header and footer. Without them every
      // marketing link in the archive is a dead end.
      // These three render their hero outside <main>, so wait on the heading.
      { name: "usecases", url: "/usecases", waitFor: "h1", anonymous: true },
      { name: "changelog", url: "/changelog", waitFor: "h1", anonymous: true },
      { name: "download", url: "/download", waitFor: "h1", anonymous: true },
      {
        name: "contact-sales",
        url: "/contact-sales",
        waitFor: "main",
        anonymous: true,
      },
      // Workspace-scoped routes: need the login hook below. They point at the
      // workspace that already carries the product's seeded data (default
      // agents, a project, real issues) rather than a freshly created empty
      // one — an empty list page shows nothing worth replicating.
      { name: "issues", url: "/test/issues", waitFor: "main" },
      { name: "my-issues", url: "/test/my-issues", waitFor: "main" },
      { name: "projects", url: "/test/projects", waitFor: "main" },
      { name: "agents", url: "/test/agents", waitFor: "main" },
      { name: "autopilots", url: "/test/autopilots", waitFor: "main" },
      { name: "skills", url: "/test/skills", waitFor: "main" },
      { name: "runtimes", url: "/test/runtimes", waitFor: "main" },
      { name: "squads", url: "/test/squads", waitFor: "main" },
      { name: "inbox", url: "/test/inbox", waitFor: "main" },
      { name: "chat", url: "/test/chat", waitFor: "main" },
      { name: "usage", url: "/test/usage", waitFor: "main" },
      { name: "billing", url: "/test/billing", waitFor: "main" },
      { name: "settings", url: "/test/settings", waitFor: "main" },
      // Detail routes. IDs come from the seeded workspace — issues accept the
      // human-readable identifier, the rest take UUIDs.
      { name: "issue-detail", url: "/test/issues/TES-1", waitFor: "main" },
      {
        name: "project-detail",
        url: "/test/projects/634f68f1-9e19-4770-85cc-8fe786b28f0d",
        waitFor: "main",
      },
      {
        name: "agent-detail",
        url: "/test/agents/463cd7e9-ce21-4d2a-ba35-c2675926488b",
        waitFor: "main",
      },
      {
        name: "skill-detail",
        url: "/test/skills/5b0d8ea9-0cdc-45b1-b2e3-9d3702cca21d",
        waitFor: "main",
      },
      {
        name: "member-detail",
        url: "/test/members/3278ae31-a0ea-43f0-9966-275946e6df75",
        waitFor: "main",
      },
      { name: "agent-new", url: "/test/agents/new", waitFor: "main" },
    ],

    themes: [
      {
        name: "light",
        colorScheme: "light",
        apply: () => {
          document.documentElement.classList.remove("dark");
        },
      },
      {
        name: "dark",
        colorScheme: "dark",
        apply: () => {
          document.documentElement.classList.add("dark");
        },
      },
    ],

    viewports: [{ name: "desktop", width: 1440, height: 900 }],

    /**
     * API login, then seed the token into localStorage before any script runs.
     *
     * Driving the login form would work but is slow and breaks whenever the
     * login page changes. This backend exposes a fixed dev verification code
     * (MULTICA_DEV_VERIFICATION_CODE, only honored when APP_ENV != production),
     * so the whole flow is two POSTs. Codes are single-use — request a fresh
     * one per run rather than caching the token.
     */
    login: async (context) => {
      // One context is created per theme and per viewport, so this hook runs
      // several times per extraction. The token is cached across those calls:
      // verification codes are single-use and /auth/send-code is rate limited,
      // so logging in again for each context fails with a 400 partway through.
      const token = await cachedToken("multica", async () => {
        const api = process.env.MULTICA_API_URL ?? "http://localhost:3001";
        const email = process.env.MULTICA_TEST_EMAIL ?? "qiaozhi_li@126.com";
        const code = process.env.MULTICA_DEV_VERIFICATION_CODE ?? "888888";

        await context.request.post(`${api}/auth/send-code`, { data: { email } });
        const verify = await context.request.post(`${api}/auth/verify-code`, {
          data: { email, code },
        });
        if (!verify.ok()) {
          throw new Error(`verify-code failed: ${verify.status()}`);
        }
        return (await verify.json()).token;
      });

      await context.addInitScript((value) => {
        localStorage.setItem("multica_token", value);
      }, token);
    },

    /**
     * Navigation the archive has to reproduce without a router.
     *
     * `patterns` resolve id-bearing routes to the single detail capture of that
     * entity type — the archive holds one issue page, not one per issue.
     * Literal segments must come before the id-shaped catch-all.
     *
     * `clickNav` covers rows that navigate from an onClick handler instead of
     * an anchor, so nothing in the markup says where they go.
     */
    routes: {
      patterns: [
        ["^/[^/]+/issues/[^/]+$", "issue-detail"],
        ["^/[^/]+/projects/[^/]+$", "project-detail"],
        ["^/[^/]+/agents/new$", "agent-new"],
        ["^/[^/]+/agents/[^/]+$", "agent-detail"],
        ["^/[^/]+/skills/[^/]+$", "skill-detail"],
        ["^/[^/]+/members/[^/]+$", "member-detail"],
      ],
      clickNav: [
        { page: "projects", selector: "[role=row]", to: "project-detail" },
        { page: "agents", selector: "[role=row]", to: "agent-detail" },
        { page: "skills", selector: "[role=row]", to: "skill-detail" },
      ],
    },

    volatileText: [],

    ignoreStyles: [],

    removeSelectors: [
      "#__next-build-watcher",
      "nextjs-portal",
      "[data-nextjs-toast]",
      "[data-nextjs-dev-tools-button]",
      "next-route-announcer",
    ],
  },

  /**
   * DeepSeek Harness (DSH) — local plugin-based agent harness at :3080.
   *
   * Single-route SPA: every view lives under "/" and is reached by clicking
   * (sidebar conversation, tabs, settings modal). Websocket + HMR keep the
   * network busy forever, so extraction must not wait for networkidle.
   * `prepare` runs in Node with the Playwright page after warmup reload,
   * before waitFor — it drives the clicks that select each view.
   */
  dsh: {
    baseUrl: process.env.SOURCE_BASE_URL ?? "http://127.0.0.1:3080",

    networkIdle: false,

    pages: [
      // Fresh session empty state (workspace picker + composer).
      { name: "home", url: "/", waitFor: "body" },
      {
        name: "conversation",
        url: "/",
        prepare: async (page) => {
          await page
            .getByText("拉取项目最新代码")
            .first()
            .click({ timeout: 5000 });
          await page.waitForTimeout(1500);
        },
        waitFor: "body",
      },
      {
        name: "trajectory",
        url: "/",
        prepare: async (page) => {
          await page
            .getByText("拉取项目最新代码")
            .first()
            .click({ timeout: 5000 });
          await page.waitForTimeout(1000);
          await page.getByText("轨迹", { exact: true }).first().click({ timeout: 5000 });
          await page.waitForTimeout(1500);
        },
        waitFor: "body",
      },
      {
        name: "settings",
        url: "/",
        prepare: async (page) => {
          await page.getByText("设置", { exact: true }).last().click({ timeout: 5000 });
          await page.waitForTimeout(1500);
        },
        waitFor: "body",
      },
    ],

    // Theme is driven by the inline boot script from prefers-color-scheme
    // (body[data-ds-dark-theme]); explicit apply keeps it deterministic.
    themes: [
      {
        name: "light",
        colorScheme: "light",
        apply: () => {
          document.body.toggleAttribute("data-ds-dark-theme", false);
        },
      },
      {
        name: "dark",
        colorScheme: "dark",
        apply: () => {
          document.body.toggleAttribute("data-ds-dark-theme", true);
        },
      },
    ],

    viewports: [{ name: "desktop", width: 1440, height: 900 }],

    login: null,

    // Sidebar shows a relative "43分钟" timestamp that drifts between runs.
    volatileText: [
      { selector: ".YDXeBa_time", text: "几分钟前" },
    ],

    ignoreStyles: [],

    removeSelectors: [],

    // Double-click-openable archive: inline the compiled CSS so Chromium's
    // file:// CORS block on <link rel=stylesheet> can't blank the styles.
    inlineCss: true,

    // The captured head carries modulepreload links (inert once the module
    // entry script is stripped); keeping them makes the DOM diff clean.
    keepModulepreload: true,

    /**
     * Navigation the archive has to reproduce without a router. The whole
     * app is one route ("/"); every "page" is a view selected by clicking.
     * Simple one-destination rules go here; text-dependent ones (session
     * rows, 对话/轨迹 tabs) are handled in dsh/assets/replica.js.
     */
    routes: {
      clickNav: [
        // Logo and 新会话 always start a fresh session (home view).
        { page: "home", selector: "button.hHd-Xa_brand", to: "home" },
        { page: "home", selector: "button.hHd-Xa_newSession", to: "home" },
        { page: "home", selector: "button.VOzbGW_trigger", to: "settings" },
        { page: "conversation", selector: "button.hHd-Xa_brand", to: "home" },
        { page: "conversation", selector: "button.hHd-Xa_newSession", to: "home" },
        { page: "conversation", selector: "button.VOzbGW_trigger", to: "settings" },
        { page: "trajectory", selector: "button.hHd-Xa_brand", to: "home" },
        { page: "trajectory", selector: "button.hHd-Xa_newSession", to: "home" },
        { page: "trajectory", selector: "button.VOzbGW_trigger", to: "settings" },
        // On the settings page the trigger is the modal's backdrop toggle:
        // clicking it closes back to the home view.
        { page: "settings", selector: "button.hHd-Xa_brand", to: "home" },
        { page: "settings", selector: "button.hHd-Xa_newSession", to: "home" },
        { page: "settings", selector: "button.VOzbGW_trigger", to: "home" },
      ],
    },
  },

  example: {
    /** Where the running app is served. No trailing slash. */
    baseUrl: process.env.SOURCE_BASE_URL ?? "http://localhost:3000",

    /**
     * Pages to capture. `name` becomes the output directory and the static
     * HTML filename, so keep it filesystem-safe and stable.
     *
     * `waitFor` is optional: a selector that must be visible before capture.
     * Prefer a content selector over a timeout — timeouts produce flaky,
     * half-rendered snapshots.
     */
    pages: [
      { name: "home", url: "/" },
      { name: "issues", url: "/demo/issues", waitFor: "[data-testid=issue-row]" },
      { name: "issue-detail", url: "/demo/issues/1", waitFor: "main" },
    ],

    /**
     * Theme variants to capture per page. `apply` runs in the browser before
     * capture. The three common mechanisms:
     *
     *   class attribute:  document.documentElement.classList.add("dark")
     *   data attribute:   document.documentElement.dataset.theme = "dark"
     *   media query:      handled via `colorScheme` below instead
     */
    themes: [
      {
        name: "light",
        colorScheme: "light",
        apply: () => {
          document.documentElement.classList.remove("dark");
          document.documentElement.removeAttribute("data-theme");
        },
      },
      {
        name: "dark",
        colorScheme: "dark",
        apply: () => {
          document.documentElement.classList.add("dark");
          document.documentElement.setAttribute("data-theme", "dark");
        },
      },
    ],

    /** Viewports to capture. Add mobile only if the replica needs it. */
    viewports: [{ name: "desktop", width: 1440, height: 900 }],

    /**
     * Optional login hook. Runs once per browser context, before any page is
     * captured. Reuse the source project's own e2e login helper when it has
     * one — API login plus a token written via addInitScript is far faster and
     * more stable than driving the login form.
     *
     * @param {import("playwright").BrowserContext} context
     */
    login: null,

    /**
     * Selectors whose text is non-deterministic (timestamps, "3 minutes ago",
     * random ids). Their text is replaced with a placeholder before capture so
     * repeated runs diff cleanly. Layout is unaffected only if the placeholder
     * has a similar length — keep it short and stable.
     */
    volatileText: [
      // { selector: "time", text: "2026-01-01" },
    ],

    /**
     * Selectors removed entirely before capture: toasts, dev overlays, chat
     * launchers, anything that appears on a timer.
     */
    ignoreStyles: [],

    removeSelectors: [
      "#__next-build-watcher",
      "nextjs-portal",
      "[data-nextjs-toast]",
      "next-route-announcer",
    ],
  },
};

/**
 * Computed-style properties captured per element.
 *
 * This list is deliberately short. getComputedStyle exposes 300+ properties;
 * capturing all of them produces JSON too large to diff usefully and floods
 * the report with noise (every inherited default counts as a "difference"
 * whenever an ancestor changes). These are the properties that actually
 * encode a design decision.
 */
export const NON_RENDERED_TAGS = ["script", "style", "template", "noscript"];

export const FREEZE_CSS = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";

export const STYLE_PROPS = [
  // Typography
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration-line",
  "white-space",
  // Color
  "color",
  "background-color",
  "opacity",
  // Box
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  // Border
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-style",
  // Effects
  "box-shadow",
  "transform",
  "filter",
  "outline",
  // Layout
  "display",
  "position",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "align-self",
  "gap",
  "row-gap",
  "column-gap",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "overflow-x",
  "overflow-y",
  "z-index",
];

/**
 * Tolerance for numeric style comparison, in CSS pixels. Sub-pixel differences
 * come from layout rounding and are not real regressions.
 */
export const PIXEL_TOLERANCE = 0.5;

export function projectConfig(slug) {
  const config = PROJECTS[slug];
  if (!config) {
    const known = Object.keys(PROJECTS).join(", ") || "(none)";
    throw new Error(`Unknown project "${slug}". Configured projects: ${known}`);
  }
  return config;
}

export function pageConfig(project, pageName) {
  const page = project.pages.find((p) => p.name === pageName);
  if (!page) {
    const known = project.pages.map((p) => p.name).join(", ");
    throw new Error(`Unknown page "${pageName}". Configured pages: ${known}`);
  }
  return page;
}

/** Output layout: ui-reference/<project>/truth/<page>__<theme>__<viewport>/ */
export function truthDir(projectSlug, pageName, themeName, viewportName) {
  return path.join(
    OUT_ROOT,
    projectSlug,
    "truth",
    `${pageName}__${themeName}__${viewportName}`,
  );
}

export function assetsDir(projectSlug) {
  return path.join(OUT_ROOT, projectSlug, "assets");
}

export function pagesDir(projectSlug) {
  return path.join(OUT_ROOT, projectSlug, "pages");
}
