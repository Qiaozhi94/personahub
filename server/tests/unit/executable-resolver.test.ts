import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter, basename } from "node:path";
import { resolveExecutable } from "../../src/runtime/executable-resolver.js";

// T009a-1: executable resolver tests, fixture-driven from real CLI shim shapes
// captured in server/tests/helpers/{claude,opencode}-protocol-fixtures.md T009a.
//
// Two real shim shapes were observed on this machine (Windows):
//   - opencode.cmd: single-layer forward straight to a bundled .exe
//   - codex.cmd:    forward to node.exe + a bundled entry .js file
// The resolver must handle both, verify target files actually exist, and never
// fall back to shell=true on failure — any unresolvable/unknown shape must
// return `resolved: null` with an explanatory errorMessage.
//
// BUG-004 (2026-09-03): this suite used to depend on the host — `putOnPath`
// *prepended* the fixture dir to the real PATH, and the fixtures were all
// Windows-shaped (`.exe` names, no exec bit). On a developer machine, which by
// definition has claude/codex installed, POSIX PATH search skipped the fixture
// (`getPathExtensions()` returns [""] off Windows, so `claude` never matches
// `claude.exe`) and hit the real binary instead. Two rules now keep the suite
// host-independent: PATH is *replaced*, never extended (`setPath`), and every
// fixture is written in the shape the running platform can actually resolve
// (`writeExecutable`).

const IS_WINDOWS = process.platform === "win32";

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

  /**
   * Replaces PATH outright. Prepending is what made this suite host-dependent
   * (BUG-004): the real agent CLIs stayed reachable, so a fixture the platform
   * could not match silently fell through to `/usr/…/bin/claude`. With PATH
   * replaced, an unmatched fixture fails as "not found" — an honest failure.
   */
  function setPath(...dirs: string[]) {
    process.env.PATH = dirs.join(delimiter);
  }

  /**
   * Writes a fixture in the shape PATH search can actually find on this
   * platform: `<name>.exe` on Windows, a bare extensionless file with the exec
   * bit on POSIX (the default codex/claude/opencode install shape — PATHEXT is
   * a Windows-only convention). Returns the real path so assertions never
   * hardcode one platform's naming.
   */
  function writeExecutable(dir: string, name: string, content = "binary"): string {
    mkdirSync(dir, { recursive: true });
    const target = join(dir, IS_WINDOWS ? `${name}.exe` : name);
    writeFileSync(target, content);
    if (!IS_WINDOWS) chmodSync(target, 0o755);
    return target;
  }

  describe("direct executables (no shim)", () => {
    it("resolves a bare executable found via PATH as source=direct with empty prefixArgs", () => {
      const binDir = join(root, "bin");
      const exePath = writeExecutable(binDir, "claude");
      setPath(binDir);

      const result = resolveExecutable("claude");

      expect(result.errorMessage).toBeNull();
      expect(result.resolved).toEqual({ executable: exePath, prefixArgs: [], source: "direct" });
    });

    it("resolves an absolute path directly without PATH search", () => {
      const exePath = writeExecutable(join(root, "somewhere"), "tool");
      // PATH points at an empty dir: resolving still succeeds only if the
      // absolute path bypassed PATH search entirely.
      setPath(root);

      const result = resolveExecutable(exePath);

      expect(result.resolved).toEqual({ executable: exePath, prefixArgs: [], source: "direct" });
    });

    it("handles paths containing spaces and unicode", () => {
      const dir = join(root, "Program Files", "café 咖啡");
      const exePath = writeExecutable(dir, "opencode");
      setPath(dir);

      const result = resolveExecutable("opencode");

      expect(result.resolved?.executable).toBe(exePath);
      expect(result.resolved?.source).toBe("direct");
    });

    it("resolves a relative path against the current working directory", () => {
      const exePath = writeExecutable(root, "tool");
      setPath(root);
      const cwd = process.cwd();
      try {
        process.chdir(root);
        const result = resolveExecutable(`./${basename(exePath)}`);
        expect(result.resolved?.executable).toBe(exePath);
        expect(result.resolved?.source).toBe("direct");
      } finally {
        process.chdir(cwd);
      }
    });

    it("does not fall back to a same-named executable elsewhere on PATH when the fixture dir has none", () => {
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      const decoyDir = join(root, "decoy");
      writeExecutable(decoyDir, "claude");
      // BUG-004 regression: only binDir is on PATH, so the decoy (standing in
      // for a real host install) must not be reachable.
      setPath(binDir);

      const result = resolveExecutable("claude");

      expect(result.resolved).toBeNull();
      expect(result.errorMessage).toMatch(/not found/i);
    });
  });

  // The three shim blocks below are Windows-only by nature, not by convenience:
  // discovering a bare `opencode` as `opencode.cmd` needs PATHEXT, and the
  // `%dp0%\node_modules\…` paths inside a real shim are backslash-separated, so
  // `expandShimMacros` + `resolvePath` only produce a real path on Windows.
  // They used to run on POSIX, where the two "fails …" cases passed for the
  // wrong reason — null because the shim was never located at all, not because
  // the parser rejected it. Skipping beats a false green; the parser's real
  // coverage lives on Windows, and `run-on-linux` coverage of the non-shim path
  // is the `direct executables` block above.
  describe.runIf(IS_WINDOWS)("verified shim: single-layer exe forward (opencode.cmd shape)", () => {
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
      setPath(binDir);

      const result = resolveExecutable("opencode");

      expect(result.errorMessage).toBeNull();
      expect(result.resolved).toEqual({ executable: targetExe, prefixArgs: [], source: "verified_shim" });
    });

    it("fails (does not fall back to shell) when the shim's target exe does not exist", () => {
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      const shimPath = join(binDir, "ghost.cmd");
      writeFileSync(shimPath, ["@ECHO off", '"%~dp0\\node_modules\\ghost-ai\\bin\\ghost.exe"   %*'].join("\r\n"));
      setPath(binDir);

      const result = resolveExecutable("ghost");

      expect(result.resolved).toBeNull();
      expect(result.errorMessage).toMatch(/not exist|not found/i);
    });
  });

  describe.runIf(IS_WINDOWS)("verified shim: node + entry .js forward (codex.cmd shape)", () => {
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
      setPath(binDir);

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
      // Only binDir on PATH, so the bare-`node` fallback has nothing to find.
      setPath(binDir);

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
      setPath(binDir);

      const result = resolveExecutable("codex");

      expect(result.resolved).toBeNull();
      expect(result.errorMessage).toMatch(/not exist|not found/i);
    });
  });

  describe.runIf(IS_WINDOWS)("unknown / unsupported shim shapes — must fail closed, never fall back to shell", () => {
    it("refuses an unrecognized .cmd shape rather than guessing", () => {
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(
        join(binDir, "weird.cmd"),
        ["@ECHO off", "for /f %%i in ('some-other-tool') do set X=%%i", "call something-unusual %X% %*"].join("\r\n"),
      );
      setPath(binDir);

      const result = resolveExecutable("weird");

      expect(result.resolved).toBeNull();
      expect(result.errorMessage).toBeTruthy();
    });

    it("refuses a .bat file with an unrecognized shape", () => {
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(
        join(binDir, "legacy.bat"),
        ["@echo off", "rem does something custom", "custom.exe %*"].join("\r\n"),
      );
      setPath(binDir);

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
      setPath(root); // empty dir, nothing on it
      const result = resolveExecutable("does-not-exist-anywhere");
      expect(result.resolved).toBeNull();
      expect(result.errorMessage).toBeTruthy();
    });
  });

  // Final-comprehensive-report regression: PATHEXT is a Windows-only
  // convention. Before the fix, getPathExtensions() fell back to
  // `.exe/.cmd/.bat/.com` on every platform, so a bare extensionless PATH
  // entry — the default install shape for codex/claude/opencode on
  // Linux/macOS — could never be found at all, unconditionally reporting
  // "Command not found". Gated to POSIX like filesystem-scanner.test.ts's
  // symlink tests, since Windows accessSync(X_OK) semantics don't model
  // POSIX executable bits.
  describe.skipIf(IS_WINDOWS)("POSIX extensionless commands (final-comprehensive-report regression)", () => {
    it("finds a bare, extensionless executable on PATH — the default codex/claude/opencode install shape", () => {
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      const target = join(binDir, "fake-cli");
      writeFileSync(target, "#!/bin/sh\necho fake\n");
      chmodSync(target, 0o755);
      setPath(binDir);

      const result = resolveExecutable("fake-cli");

      expect(result.resolved).toEqual({ executable: target, prefixArgs: [], source: "direct" });
    });

    it("does not match a same-named file that isn't executable", () => {
      const binDir = join(root, "bin");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, "not-executable"), "just data\n");
      chmodSync(join(binDir, "not-executable"), 0o644);
      setPath(binDir);

      const result = resolveExecutable("not-executable");

      expect(result.resolved).toBeNull();
    });
  });
});
