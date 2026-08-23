#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { OUT_ROOT } from "./config.mjs";
import { writeGzipText } from "./compressed-artifact.mjs";

const TRUTH_TEXT_FILES = new Set([
  "dom.html",
  "styles.json",
  "vars.json",
  "inline-styles.css",
  "meta.json",
]);

async function collectTruthFiles(directory) {
  const found = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectTruthFiles(fullPath)));
    } else if (TRUTH_TEXT_FILES.has(entry.name)) {
      found.push(fullPath);
    }
  }
  return found;
}

let originalBytes = 0;
let compressedBytes = 0;
let fileCount = 0;

for (const project of await fs.readdir(OUT_ROOT, { withFileTypes: true })) {
  if (!project.isDirectory()) continue;
  const truthRoot = path.join(OUT_ROOT, project.name, "truth");
  try {
    await fs.access(truthRoot);
  } catch {
    continue;
  }

  for (const file of await collectTruthFiles(truthRoot)) {
    const stat = await fs.stat(file);
    const text = await fs.readFile(file, "utf8");
    originalBytes += stat.size;
    compressedBytes += await writeGzipText(file, text);
    fileCount += 1;
  }
}

console.log(
  `compressed ${fileCount} truth files: ${(originalBytes / 1048576).toFixed(2)} MB -> ${(compressedBytes / 1048576).toFixed(2)} MB`,
);
