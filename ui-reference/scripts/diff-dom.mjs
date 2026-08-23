#!/usr/bin/env node
/**
 * Phase 4 — structural verification.
 *
 * Compares a replica's DOM tree against the captured truth and reports missing,
 * extra, and reordered nodes.
 *
 * Nodes are addressed by childIndex path ("0/2/1/3") rather than CSS selector.
 * A selector-based diff collapses under small drift — one renamed class
 * invalidates every selector beneath it, so a single real defect reports as
 * hundreds. Index paths localise the damage and name the exact child that is
 * wrong.
 *
 * Usage:
 *   node diff-dom.mjs <project> <page> [--theme light] [--viewport desktop]
 *   node diff-dom.mjs <project> <page> --replica path/to/replica.html
 *
 * Exit code is 1 when differences are found, so it can gate CI.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { NON_RENDERED_TAGS, pagesDir, projectConfig, truthDir } from "./config.mjs";
import { readTextArtifact } from "./compressed-artifact.mjs";

const args = process.argv.slice(2);
const [projectSlug, pageName] = args;

if (!projectSlug || !pageName) {
  console.error("usage: node diff-dom.mjs <project> <page> [--theme t] [--viewport v] [--replica file]");
  process.exit(1);
}

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const project = projectConfig(projectSlug);
const themeName = flag("theme", project.themes[0].name);
const viewportName = flag("viewport", project.viewports[0].name);
const replicaPath =
  flag("replica", null) ?? path.join(pagesDir(projectSlug), `${pageName}.html`);

/**
 * Minimal element-tree parser.
 *
 * A full HTML parser would be more correct, but it pulls in a dependency and
 * this comparison only needs tag name, class list, and child order. Text nodes
 * are deliberately ignored: content differs legitimately between captures
 * (seeded data, timestamps) while structure must not.
 */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const SKIP_CONTENT_TAGS = new Set(NON_RENDERED_TAGS);

function parseTree(html) {
  const root = { tag: "#root", classes: [], children: [] };
  const stack = [root];
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

  let match;
  let skipUntil = null;

  while ((match = tagPattern.exec(html)) !== null) {
    const [full, closing, rawTag, rawAttrs] = match;
    const tag = rawTag.toLowerCase();

    if (skipUntil) {
      if (closing && tag === skipUntil) skipUntil = null;
      continue;
    }

    if (closing) {
      if (stack.length > 1 && stack[stack.length - 1].tag === tag) stack.pop();
      continue;
    }

    if (SKIP_CONTENT_TAGS.has(tag)) {
      if (!full.endsWith("/>")) skipUntil = tag;
      continue;
    }

    // Nodes the replica pipeline injects itself (the interaction layer). They
    // have no counterpart in the source and would otherwise report as an extra
    // node on every single page.
    if (/\sdata-replica-runtime\b/i.test(rawAttrs)) {
      if (!full.endsWith("/>") && !VOID_TAGS.has(tag)) skipUntil = tag;
      continue;
    }

    const classMatch = rawAttrs.match(/\sclass=("([^"]*)"|'([^']*)')/i);
    const classValue = classMatch ? classMatch[2] ?? classMatch[3] ?? "" : "";
    const node = {
      tag,
      classes: classValue.split(/\s+/).filter(Boolean).sort(),
      children: [],
    };

    stack[stack.length - 1].children.push(node);

    const selfClosing = full.endsWith("/>") || VOID_TAGS.has(tag);
    if (!selfClosing) stack.push(node);
  }

  // The capture starts at <html>; unwrap so paths line up with styles.json.
  return root.children[0] ?? root;
}

function flatten(node, pathParts = [], out = new Map()) {
  const key = pathParts.join("/") || "root";
  out.set(key, { tag: node.tag, classes: node.classes });
  node.children.forEach((child, index) => {
    flatten(child, [...pathParts, String(index)], out);
  });
  return out;
}

function classDelta(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    missing: expected.filter((c) => !actualSet.has(c)),
    extra: actual.filter((c) => !expectedSet.has(c)),
  };
}

async function main() {
  const dir = truthDir(projectSlug, pageName, themeName, viewportName);
  const truthHtml = await readTextArtifact(path.join(dir, "dom.html"));

  let replicaHtml;
  try {
    replicaHtml = await fs.readFile(replicaPath, "utf8");
  } catch {
    console.error(`replica not found: ${replicaPath}`);
    console.error("run staticize.mjs first, or pass --replica <file>");
    process.exit(1);
  }

  const truth = flatten(parseTree(truthHtml));
  const replica = flatten(parseTree(replicaHtml));

  /** @type {{kind: string, path: string, detail: string}[]} */
  const findings = [];

  for (const [key, expected] of truth) {
    const actual = replica.get(key);
    if (!actual) {
      findings.push({
        kind: "missing",
        path: key,
        detail: `<${expected.tag}> not present in replica`,
      });
      continue;
    }
    if (actual.tag !== expected.tag) {
      findings.push({
        kind: "tag",
        path: key,
        detail: `expected <${expected.tag}>, got <${actual.tag}>`,
      });
      continue;
    }
    const delta = classDelta(expected.classes, actual.classes);
    if (delta.missing.length > 0 || delta.extra.length > 0) {
      const parts = [];
      if (delta.missing.length > 0) parts.push(`missing: ${delta.missing.join(" ")}`);
      if (delta.extra.length > 0) parts.push(`extra: ${delta.extra.join(" ")}`);
      findings.push({
        kind: "class",
        path: key,
        detail: `<${expected.tag}> ${parts.join(" | ")}`,
      });
    }
  }

  for (const [key, actual] of replica) {
    if (!truth.has(key)) {
      findings.push({
        kind: "extra",
        path: key,
        detail: `<${actual.tag}> not present in source`,
      });
    }
  }

  if (findings.length === 0) {
    console.log(`ok  ${pageName} [${themeName}/${viewportName}] — ${truth.size} nodes match`);
    return;
  }

  // Shallow paths first: a wrong ancestor explains its whole subtree, so fixing
  // top-down avoids chasing consequences instead of causes.
  findings.sort((a, b) => {
    const depth = a.path.split("/").length - b.path.split("/").length;
    return depth !== 0 ? depth : a.path.localeCompare(b.path);
  });

  const counts = findings.reduce((acc, f) => {
    acc[f.kind] = (acc[f.kind] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `FAIL ${pageName} [${themeName}/${viewportName}] — ` +
      `${findings.length} finding(s): ` +
      Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", "),
  );
  console.log(`(truth ${truth.size} nodes, replica ${replica.size} nodes)\n`);

  for (const finding of findings.slice(0, 40)) {
    console.log(`  [${finding.kind}] ${finding.path}`);
    console.log(`      ${finding.detail}`);
  }
  if (findings.length > 40) {
    console.log(`\n  ... and ${findings.length - 40} more`);
  }
  console.log("\nFix the shallowest paths first — deeper findings are usually consequences.");

  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
