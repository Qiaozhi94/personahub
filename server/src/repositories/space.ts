import type Database from "better-sqlite3";
import type { Space, SpaceState } from "@personahub/shared/types";
import { generateSpaceId } from "../id.js";

interface SpaceRow {
  id: string;
  name: string;
  state: string;
  is_default: number;
  is_selected: number;
  created_at: string;
  updated_at: string;
}

function mapRow(row: SpaceRow): Space {
  return {
    id: row.id,
    name: row.name,
    state: row.state as SpaceState,
    is_default: row.is_default === 1,
    is_selected: row.is_selected === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class SpaceRepository {
  constructor(private db: Database.Database) {}

  create(name: string, isDefault: boolean, isSelected: boolean): Space {
    const id = generateSpaceId();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO spaces (id, name, state, is_default, is_selected, created_at, updated_at)
         VALUES (?, ?, 'active', ?, ?, ?, ?)`,
      )
      .run(id, name, isDefault ? 1 : 0, isSelected ? 1 : 0, now, now);
    return this.getById(id) as Space;
  }

  getById(id: string): Space | null {
    const row = this.db.prepare("SELECT * FROM spaces WHERE id = ?").get(id) as SpaceRow | undefined;
    return row ? mapRow(row) : null;
  }

  getDefault(): Space | null {
    const row = this.db.prepare("SELECT * FROM spaces WHERE is_default = 1").get() as SpaceRow | undefined;
    return row ? mapRow(row) : null;
  }

  getSelected(): Space | null {
    const row = this.db.prepare("SELECT * FROM spaces WHERE is_selected = 1").get() as SpaceRow | undefined;
    return row ? mapRow(row) : null;
  }

  list(): Space[] {
    // 选中项在前，其余按创建时间倒序；列表顺序是 UI 契约的一部分。
    return (
      this.db.prepare("SELECT * FROM spaces ORDER BY is_selected DESC, created_at DESC, id ASC").all() as SpaceRow[]
    ).map(mapRow);
  }

  /** 单事务内清旧选中、置新选中；调用方（SpaceService）负责校验目标状态。 */
  select(id: string): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE spaces SET is_selected = 0, updated_at = ? WHERE is_selected = 1").run(now);
      this.db.prepare("UPDATE spaces SET is_selected = 1, updated_at = ? WHERE id = ?").run(now, id);
    })();
  }

  setState(id: string, state: SpaceState, updatedAt: string): void {
    this.db.prepare("UPDATE spaces SET state = ?, updated_at = ? WHERE id = ?").run(state, updatedAt, id);
  }
}
