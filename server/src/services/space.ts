// F013 T003: SpaceService 是 Space 创建 / 选择 / 归档的唯一写入口，并拥有
// 默认 Space 的幂等升级语义（design.md §2）。生命周期：v0.3 不支持物理删除。

import type Database from "better-sqlite3";
import type { Space } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { SpaceRepository } from "../repositories/space.js";
import { AppError } from "../api/errors.js";
import { AuditService } from "./audit.js";
import {
  computeGroupStates,
  listCandidatesForSpace,
  upsertSpaceStates,
} from "./skill-space-state.js";

export class SpaceService {
  constructor(
    private spaceRepo: SpaceRepository,
    private audit: AuditService,
    private db: Database.Database,
  ) {}

  /**
   * 首个 Space 同时置 is_default=1 与 is_selected=1（初始重合，之后独立演化）；
   * 后续创建不改变当前选中。同一事务内为所有全局 Skill 物化该 Space 的
   * skill_space_state 行（新 Space 里只有全局 Skill，彼此同名才会是 conflict）。
   */
  create(name?: string): Space {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new AppError(ErrorCode.SPACE_NAME_REQUIRED, "Space name is required.", "name");
    }

    return this.db.transaction(() => {
      const isDefault = this.spaceRepo.getDefault() === null;
      const space = this.spaceRepo.create(trimmed, isDefault, isDefault);

      const now = new Date().toISOString();
      const candidates = listCandidatesForSpace(this.db, space.id);
      const states = computeGroupStates(candidates);
      upsertSpaceStates(
        this.db,
        [...states.entries()].map(([skillId, state]) => ({ skillId, spaceId: space.id, state })),
        now,
      );

      this.audit.record("space.created", "space", space.id, {
        name: space.name,
        is_default: space.is_default,
        is_selected: space.is_selected,
      });
      return space;
    })();
  }

  list(): Space[] {
    return this.spaceRepo.list();
  }

  getById(id: string): Space {
    const space = this.spaceRepo.getById(id);
    if (!space) {
      throw new AppError(ErrorCode.SPACE_NOT_FOUND, "Space not found.");
    }
    return space;
  }

  getSelected(): Space | null {
    return this.spaceRepo.getSelected();
  }

  select(id: string): Space {
    return this.db.transaction(() => {
      const space = this.getById(id);
      if (space.state !== "active") {
        throw new AppError(ErrorCode.SPACE_NOT_ACTIVE, "Cannot select an archived space.");
      }
      this.spaceRepo.select(id);
      const updated = this.getById(id);
      this.audit.record("space.selected", "space", id, { name: updated.name });
      return updated;
    })();
  }

  archive(id: string): Space {
    return this.db.transaction(() => {
      const space = this.getById(id);
      // 默认 Space 永不可归档：历史数据以它为归属根；当前选中亦不可归档。
      if (space.is_default) {
        throw new AppError(ErrorCode.SPACE_ARCHIVE_BLOCKED, "The default space cannot be archived.");
      }
      if (space.is_selected) {
        throw new AppError(ErrorCode.SPACE_ARCHIVE_BLOCKED, "The currently selected space cannot be archived.");
      }
      if (space.state === "archived") {
        return space;
      }
      const now = new Date().toISOString();
      this.spaceRepo.setState(id, "archived", now);
      this.audit.record("space.archived", "space", id, { name: space.name });
      return this.getById(id);
    })();
  }

  restore(id: string): Space {
    return this.db.transaction(() => {
      const space = this.getById(id);
      if (space.state === "active") {
        return space;
      }
      this.spaceRepo.setState(id, "active", new Date().toISOString());
      // restore 不自动选中（design §3）。
      this.audit.record("space.restored", "space", id, { name: space.name });
      return this.getById(id);
    })();
  }
}
