import fs from "node:fs/promises";
import { constants, gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export async function readTextArtifact(plainPath) {
  try {
    return await fs.readFile(plainPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const compressed = await fs.readFile(`${plainPath}.gz`);
  return (await gunzipAsync(compressed)).toString("utf8");
}

export async function writeGzipText(plainPath, text) {
  const gzipPath = `${plainPath}.gz`;
  const temporaryPath = `${gzipPath}.tmp-${process.pid}`;
  const compressed = await gzipAsync(Buffer.from(text, "utf8"), {
    level: constants.Z_BEST_COMPRESSION,
  });

  try {
    await fs.writeFile(temporaryPath, compressed);
    await fs.rm(gzipPath, { force: true });
    await fs.rename(temporaryPath, gzipPath);
    await fs.rm(plainPath, { force: true });
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }

  return compressed.length;
}
