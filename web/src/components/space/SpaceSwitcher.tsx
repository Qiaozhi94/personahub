import { useState } from "react";
import { useCreateSpace, useSelectSpace, useSpaces } from "@/hooks/use-spaces";

// F013 T008：首次设置与 Space 切换。选中态存在服务端（GET /api/spaces 的
// is_selected 事实），切换即改写服务端焦点；创建的 Space 不自动选中
//（首个/默认 Space 由迁移保证存在，见 design §3）。

export function SpaceSwitcher() {
  const spacesQuery = useSpaces();
  const select = useSelectSpace();
  const create = useCreateSpace();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const spaces = spacesQuery.data?.spaces ?? [];
  const selected = spaces.find((space) => space.is_selected) ?? null;

  return (
    <div aria-label="Space 切换" data-testid="space-switcher">
      <select
        aria-label="当前 Space"
        value={selected?.id ?? ""}
        onChange={(event) => {
          if (event.target.value) select.mutate(event.target.value);
        }}
      >
        {selected === null && spaces.length === 0 ? <option value="">（尚未创建 Space）</option> : null}
        {spaces.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
            {space.is_default ? "（默认）" : ""}
            {space.state === "archived" ? "（已归档）" : ""}
          </option>
        ))}
      </select>

      {creating ? (
        <form
          aria-label="创建 Space"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() === "") return;
            create.mutate(name.trim(), {
              onSuccess: () => {
                setCreating(false);
                setName("");
              },
            });
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Space 名称"
            aria-label="Space 名称"
          />
          <button type="submit" disabled={create.isPending} aria-label="确认创建 Space">
            创建
          </button>
        </form>
      ) : (
        <button type="button" aria-label="新建 Space" onClick={() => setCreating(true)}>
          新建
        </button>
      )}
    </div>
  );
}
