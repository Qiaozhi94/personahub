import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, CURRENT_SCHEMA_VERSION } from "../../src/db/migrations.js";
import { loadV02SnapshotSql, loadV02SeedSql } from "../fixtures/build-v02-fixture.js";

// F013 AC-001 (design §8 migration-runner-fk)：三条由测试锁定的编排约束——
// ① migration 前后 foreign_keys 均为 ON；② 抛异常的失败路径也必须恢复 ON；
// ③ schema_version 与表结构在同一事务内提交，不存在"表已改、版本没记"的中间态。

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function buildV10FileDb(): Database.Database {
  tempDir = mkdtempSync(join(tmpdir(), "f013-runner-fk-"));
  const db = new Database(join(tempDir, "v10.db"));
  db.pragma("foreign_keys = ON");
  db.exec(loadV02SnapshotSql());
  db.exec(loadV02SeedSql());
  return db;
}

describe("F013 migration orchestration (FK switch / failure recovery / atomic version)", () => {
  it("keeps foreign_keys ON before and after the upgrade", () => {
    const db = buildV10FileDb();
    try {
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
      applyMigrations(db);
      const restored = db.pragma("foreign_keys", { simple: true });
      expect(restored).toBe(1);
      const version = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
      expect(version.v).toBe(CURRENT_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it("restores foreign_keys ON even when the migration fails mid-flight", () => {
    const db = buildV10FileDb();
    try {
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);

      // 注入异常：hook 进 applyV12 的事务内部。schema_version 表是 runner 自己建的，
      // 这里用 triggers 表不存在的注入点——直接给 spaces 表加一个必然触发的 CHECK 失败
      // 不可行，因此退而求其次：监视事务内首个 DML 之后的 foreign_key_check 不现实；
      // 改为 monkey-patch better-sqlite3 的 transaction 包装在 applyV12 首个 exec 抛错。
      const origExec = db.exec.bind(db);
      let injected = false;
      // @ts-expect-error test-only monkey patch
      db.exec = (sql: string): unknown => {
        if (!injected && sql.includes("CREATE TABLE IF NOT EXISTS spaces")) {
          injected = true;
          throw new Error("injected v12 failure");
        }
        return origExec(sql);
      };

      expect(() => applyMigrations(db)).toThrow(/injected v12 failure/);

      // 失败路径也必须恢复 ON。
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
      // 无"表已改、版本没记"的中间态：v11 已在自身事务提交（v12 在自己的事务里失败），
      // 停在 v11；v13（F010 artifacts）因 v12 未完成而未执行；spaces 表不存在（v12 整体回滚）。
      const version = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
      expect(version.v).toBe(11);
      const hasOldProjects = db
        .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='projects'")
        .get() as { c: number };
      expect(hasOldProjects.c).toBe(1);
      const hasSpaces = db
        .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='spaces'")
        .get() as { c: number };
      expect(hasSpaces.c).toBe(0);
    } finally {
      db.close();
    }
  });

  it("commits schema_version and tables atomically on success", () => {
    const db = buildV10FileDb();
    try {
      applyMigrations(db);
      // 版本与结构同事务提交：head 版本存在且新表可查。
      const version = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
      expect(version.v).toBe(CURRENT_SCHEMA_VERSION);
      const spaces = db.prepare("SELECT COUNT(*) AS c FROM spaces WHERE is_default = 1").get() as { c: number };
      expect(spaces.c).toBe(1);
    } finally {
      db.close();
    }
  });
});
