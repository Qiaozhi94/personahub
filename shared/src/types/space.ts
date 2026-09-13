// F013: Space 是 Project、Issue 与 Space 级 Skill 的持久化归属根（FR-001）。
// is_default 与 is_selected 是两个不可互相推导的事实：default 是升级归属根
// （一经创建不再改变），selected 是当前工作焦点（用户每次切换即改写）。

export interface Space {
  id: string;
  name: string;
  state: SpaceState;
  is_default: boolean;
  is_selected: boolean;
  created_at: string;
  updated_at: string;
}

export type SpaceState = "active" | "archived";

export interface SpaceCreateInput {
  name: string;
}

export interface SpaceCreateResponse {
  space: Space;
}

export interface SpaceListResponse {
  spaces: Space[];
}

export interface SpaceActionResponse {
  space: Space;
}
