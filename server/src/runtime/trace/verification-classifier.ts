import { VerificationKind } from "@personahub/shared/types";

interface Token {
  value: string;
}

function tokenizeCommand(command: string): Token[] {
  const tokens: Token[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === " " && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push({ value: current });
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current.length > 0) {
    tokens.push({ value: current });
  }

  return tokens;
}

const TEST_EXECUTABLES = new Set([
  "vitest",
  "jest",
  "pytest",
  "cargo",
  "go",
  "dotnet",
  "mvn",
  "mvnw",
  "gradle",
  "gradlew",
]);

const TEST_SUBCOMMANDS: Record<string, Set<string>> = {
  cargo: new Set(["test", "t"]),
  go: new Set(["test", "t"]),
  dotnet: new Set(["test", "t"]),
  mvn: new Set(["test"]),
  mvnw: new Set(["test"]),
  gradle: new Set(["test"]),
  gradlew: new Set(["test"]),
};

const LINT_KEYWORDS = new Set(["lint", "eslint", "biome", "ruff", "flake8", "pylint", "golangci-lint"]);
const TYPECHECK_KEYWORDS = new Set(["typecheck", "tsc", "mypy", "pyright"]);
const BUILD_KEYWORDS = new Set(["build", "webpack", "vite", "tsc", "rollup", "esbuild", "make", "cmake"]);

function stripWrapper(tokens: Token[]): Token[] {
  if (tokens.length === 0) return tokens;

  const first = tokens[0].value;
  const lower = first.toLowerCase().replace(/^\.\//, "");

  if (lower === "&" || lower === "powershell" || lower === "pwsh") {
    const rest = tokens.slice(1);
    if (rest.length > 0) {
      const flag = rest[0].value.toLowerCase();
      if (flag === "-command" || flag === "-c" || flag === "/c" || flag === "-cmd") {
        return stripWrapper(rest.slice(1));
      }
    }
    return stripWrapper(rest);
  }
  if (lower === "cmd") {
    const rest = tokens.slice(1);
    if (rest.length > 0) {
      const flag = rest[0].value.toLowerCase();
      if (flag === "/c" || flag === "/k") {
        return stripWrapper(rest.slice(1));
      }
    }
    return stripWrapper(rest);
  }
  if (lower === "npx" || lower === "pnpx") {
    return stripWrapper(tokens.slice(1));
  }

  return tokens;
}

function stripRunKeyword(tokens: Token[]): Token[] {
  if (tokens.length >= 2) {
    const second = tokens[1].value.toLowerCase();
    if (second === "run") {
      return [tokens[0], ...tokens.slice(2)];
    }
  }
  return tokens;
}

export function classifyVerificationCommand(
  command: string,
  platform: string = process.platform,
): VerificationKind | null {
  if (typeof command !== "string" || command.trim().length === 0) {
    return null;
  }

  const tokens = stripRunKeyword(stripWrapper(tokenizeCommand(command.trim())));
  if (tokens.length === 0) {
    return null;
  }

  const executable = tokens[0].value.toLowerCase().replace(/^\.\//, "");
  const subcommand = tokens[1]?.value?.toLowerCase() ?? "";

  if (TEST_EXECUTABLES.has(executable)) {
    if (executable === "vitest" || executable === "jest") {
      return VerificationKind.Test;
    }
    if (executable === "pytest") {
      return VerificationKind.Test;
    }
    const validSubs = TEST_SUBCOMMANDS[executable];
    if (validSubs && validSubs.has(subcommand)) {
      return VerificationKind.Test;
    }
    return null;
  }

  if (executable === "npm" || executable === "pnpm" || executable === "yarn" || executable === "bun") {
    if (subcommand === "test") {
      return VerificationKind.Test;
    }
    if (LINT_KEYWORDS.has(subcommand)) {
      return VerificationKind.Lint;
    }
    if (TYPECHECK_KEYWORDS.has(subcommand)) {
      return VerificationKind.Typecheck;
    }
    if (BUILD_KEYWORDS.has(subcommand)) {
      return VerificationKind.Build;
    }
    return null;
  }

  if (LINT_KEYWORDS.has(executable)) {
    return VerificationKind.Lint;
  }
  if (TYPECHECK_KEYWORDS.has(executable)) {
    return VerificationKind.Typecheck;
  }
  if (BUILD_KEYWORDS.has(executable) && executable !== "tsc") {
    return VerificationKind.Build;
  }
  if (executable === "tsc" && subcommand === "--noemit") {
    return VerificationKind.Typecheck;
  }
  if (executable === "tsc" && tokens.length === 1) {
    return VerificationKind.Typecheck;
  }

  return null;
}
