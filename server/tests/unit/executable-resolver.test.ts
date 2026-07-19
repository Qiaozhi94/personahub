import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { resolveExecutable } from "../../src/runtime/executable-resolver.js";

// T009a-1: executable resolver tests, fixture-driven from real CLI shim shapes
// captured in server/tests/helpers/{claude,opencode}-protocol-fixtures.md T009a.
//
// Two real shim shapes were observed on this machine:
//   - opencode.cmd: single-layer forward straight to a bundled .exe
//   - codex.cmd:    forward to node.exe + a bundled entry .js file
// The resolver must handle both, verify target files actually exist, and never
// fall back to shell=true on failure — any unresolvable/unknown shape must
// return `resolved: null` with an explanatory errorMessage.

describe("resolveExecutable (T009a)", () => {
  let root: string;
  let savedPath: string | undefined;
  let savedPathExt: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "resolver-test-"));
    savedPath = process.env.PATH;
    savedPathExt = process.env.PATHEXT;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedPathExt === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = savedPathExt;
  });

  function putOnPath(dir: string) {
    process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
  }

  describe("direct executables (no shim)", () => {
    it("resolves a bare .exe found via PATH as source=direct with empty prefixArgs", () => {
      const binDir = join(root, "bin");
      mkdirSync(binDir);
      const exePath = join(binDir, "claude.exe");
      writeFileSync(exePath, "not a real binary, just needs to exist");
      putOnPath(binDir);

      const result = resolveExecutable("claude");

      expect(result.errorMessage).toBeNull();
      expect(result.resolved).toEqual({ executable: exePath, prefixArgs: [], source: "direct" });
    });

    it("resolves an absolute path directly without PATH search", () => {
      const exePath = join(root, "somewhere", "tool.exe");
      mkdirSync(join(root, "somewhere"));
      writeFileSync(exePath, "binary");

      const result = resolveExecutable(exePath);

      expect(result.resolved).toEqual({ executable: exePath, prefixArgs: [], source: "direct" });
    });

    it("handles paths containing spaces and unicode", () => {
      const dir = join(root, "Program Files", "café 咖啡");
      mkdirSync(dir, { recursive: true });
      const exePath = join(dir, "opencode.exe");
      writeFileSync(exePath, "binary");
      putOnPath(dir);

      const result = resolveExecutable("opencode");

      expect(result.resolved?.executable).toBe(exePath);
      expect(result.resolved?.source).toBe("direct");
    });

    it("resolves a relative path against the current working directory", () => {
      const exePath = join(root, "tool.exe");
      writeFileSync(exePath, "binary");
      const cwd = process.cwd();
      try {
        process.chdir(root);
        const result = resolveExecutable("./tool.exe");
        expect(result.resolved?.executable).toBe(join(root, "tool.exe"));
        expect(result.resolved?.source).toBe("direct");
      } finally {
        process.chdir(cwd);
      }
    });
  });

  describe("verified shim: single-layer exe forward (opencode.cmd shape)", () => {
    it("resolves the real target exe and reports source=verified_shim", () => {
      const binDir = join(root, "bin");
      const nodeModulesExe = join(binDir, "node_modules", "opencode-ai", "bin");
      mkdirSync(nodeModulesExe, { recursive: true });
      const targetExe = join(nodeModulesExe, "opencode.exe");
      writeFileSync(targetExe, "real binary");

      const shimPath = join(binDir, "opencode.cmd");
      writeFileSync(
        shimPath,
        [
          "@ECHO off",
          "GOTO start",
          ":find_dp0",
          "SET dp0=%~dp0",
          "EXIT /b",
          ":start",
          "SETLOCAL",
          "CALL :find_dp0",
          '"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*',
        ].join("\r\n"),
      );
      putOnPath(binDir);

      const result = resolveExecutable("opencode");

      expect(result.errorMessage).toBeNull();
      expect(result.resolved).toEqual({ executable: targetExe, prefixArgs: [], source: "verified_shim" });
    });

    it("fails (does not fall back to shell) when the shim's target exe does not exist", () => {
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      const shimPath = join(binDir, "ghost.cmd");
      writeFileSync(
        shimPath,
        ['@ECHO off', '"%~dp0\\node_modules\\ghost-ai\\bin\\ghost.exe"   %*'].join("\r\n"),
      );
      putOnPath(binDir);

      const result = resolveExecutable("ghost");

      expect(result.resolved).toBeNull();
      expect(result.errorMessage).toMatch(/not exist|not found/i);
    });
  });

  describe("verified shim: node + entry .js forward (codex.cmd shape)", () => {
    it("resolves node.exe and the entry .js as prefixArgs[0]", () => {
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      const nodeExe = join(binDir, "node.exe");
      writeFileSync(nodeExe, "real node binary");
      const entryDir = join(binDir, "node_modules", "@openai", "codex", "bin");
      mkdirSync(entryDir, { recursive: true });
      const entryJs = join(entryDir, "codex.js");
      writeFileSync(entryJs, "console.log('codex')");

      const shimPath = join(binDir, "codex.cmd");
      writeFileSync(
        shimPath,
        [
          "@ECHO off",
          "GOTO start",
          ":find_dp0",
          "SET dp0=%~dp0",
          "EXIT /b",
          ":start",
          "SETLOCAL",
          "CALL :find_dp0",
          "",
          'IF EXIST "%dp0%\\node.exe" (',
          '  SET "_prog=%dp0%\\node.exe"',
          ") ELSE (",
          '  SET "_prog=node"',
          "  SET PATHEXT=%PATHEXT:;.JS;=;%",
          ")",
          "",
          'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
        ].join("\r\n"),
      );
      putOnPath(binDir);

      const result = resolveExecutable("codex");

      expect(result.errorMessage).toBeNull();
      expect(result.resolved).toEqual({ executable: nodeExe, prefixArgs: [entryJs], source: "verified_shim" });
    });

    it("fails when the embedded node.exe is missing and no bare node fallback can be verified", () => {
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      const entryDir = join(binDir, "node_modules", "@openai", "codex", "bin");
      mkdirSync(entryDir, { recursive: true });
      writeFileSync(join(entryDir, "codex.js"), "console.log('codex')");

      const shimPath = join(binDir, "codex.cmd");
      writeFileSync(
        shimPath,
        [
          "@ECHO off",
          'IF EXIST "%~dp0\\node.exe" (',
          '  SET "_prog=%~dp0\\node.exe"',
          ") ELSE (",
          '  SET "_prog=node"',
          ")",
          '"%_prog%"  "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
        ].join("\r\n"),
      );
      putOnPath(binDir);
      // ensure no real "node" is resolvable either, by pointing PATH only at binDir
      process.env.PATH = binDir;

      const result = resolveExecutable("codex");

      expect(result.resolved).toBeNull();
      expect(result.errorMessage).toBeTruthy();
    });

    it("fails when the entry .js file does not exist", () => {
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, "node.exe"), "node binary");
      const shimPath = join(binDir, "codex.cmd");
      writeFileSync(
        shimPath,
        [
          "@ECHO off",
          'IF EXIST "%~dp0\\node.exe" (SET "_prog=%~dp0\\node.exe") ELSE (SET "_prog=node")',
          '"%_prog%"  "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
        ].join("\r\n"),
      );
      putOnPath(binDir);

      const result = resolveExecutable("codex");

      expect(result.resolved).toBeNull();
      expect(result.errorMessage).toMatch(/not exist|not found/i);
    });
  });

  describe("unknown / unsupported shim shapes — must fail closed, never fall back to shell", () => {
    it("refuses an unrecognized .cmd shape rather than guessing", () => {
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(
        join(binDir, "weird.cmd"),
        ["@ECHO off", "for /f %%i in ('some-other-tool') do set X=%%i", "call something-unusual %X% %*"].join("\r\n"),
      );
      putOnPath(binDir);

      const result = resolveExecutable("weird");

      expect(result.resolved).toBeNull();
      expect(result.errorMessage).toBeTruthy();
    });

    it("refuses a .bat file with an unrecognized shape", () => {
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, "legacy.bat"), ["@echo off", "rem does something custom", "custom.exe %*"].join("\r\n"));
      putOnPath(binDir);

      const result = resolveExecutable("legacy");

      expect(result.resolved).toBeNull();
    });
  });

  describe("failure cases", () => {
    it("returns an error for an empty command", () => {
      const result = resolveExecutable("   ");
      expect(result.resolved).toBeNull();
      expect(result.errorMessage).toMatch(/empty/i);
    });

    it("returns an error when the command cannot be found on PATH", () => {
      process.env.PATH = root; // empty dir, nothing on it
      const result = resolveExecutable("does-not-exist-anywhere");
      expect(result.resolved).toBeNull();
      expect(result.errorMessage).toBeTruthy();
    });
  });
});
