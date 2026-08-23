// 打印静态复刻页的结构骨架：只到指定深度，带首段文本，用于判断可剪区块
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const [file, maxDepth = "6"] = process.argv.slice(2);
const dom = new JSDOM(readFileSync(file, "utf8"));
const doc = dom.window.document;
const limit = Number(maxDepth);

const skip = new Set(["SCRIPT", "STYLE", "SVG", "PATH", "LINK", "META", "NOSCRIPT"]);

function label(el) {
  const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 6).join(".");
  const role = el.getAttribute("role") || el.getAttribute("aria-label") || "";
  const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70);
  return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${role ? ` [${role}]` : ""} :: ${text}`;
}

function walk(el, depth) {
  if (depth > limit || skip.has(el.tagName)) return;
  console.log("  ".repeat(depth) + label(el));
  for (const child of el.children) walk(child, depth + 1);
}

walk(doc.body, 0);
