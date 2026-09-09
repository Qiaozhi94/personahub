import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppDialog, AppDialogClose } from "@/components/primitives/app-dialog";
import { AppTabs, AppTabsList, AppTabsTrigger } from "@/components/primitives/app-tabs";
import { DataTable, type DataTableColumn } from "@/components/primitives/data-table";
import {
  DisabledAction,
  StatusBanner,
  TransientFeedback,
  useTransientFeedback,
} from "@/components/primitives/feedback";
import { EmptyState, ErrorState, PageLoading, PartialState } from "@/components/primitives/page-state";

// Shared-primitive contract for F009 (UX-001/UX-002): one dialog / tabs /
// table / feedback / page-state semantics suite, applied here once so pages
// cannot hand-roll divergent copies. BC-046/048/049/050/051/052.

function DialogHarness(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开示例
      </button>
      <AppDialog open={open} onOpenChange={setOpen} title="确认执行" description="启动后 Run 会进入队列。">
        <button type="button" onClick={() => setOpen(false)}>
          第一个操作
        </button>
        <AppDialogClose>第二个操作</AppDialogClose>
      </AppDialog>
    </>
  );
}

describe("AppDialog", () => {
  it("exposes dialog semantics with an accessible title", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "打开示例" }));

    const dialog = screen.getByRole("dialog", { name: "确认执行" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("启动后 Run 会进入队列。")).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "打开示例" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "确认执行" });
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "确认执行" })).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps Tab focus inside the dialog while it is open", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "打开示例" }));

    const dialog = screen.getByRole("dialog", { name: "确认执行" });
    const inside = screen.getByRole("button", { name: "第一个操作" });
    inside.focus();
    fireEvent.keyDown(inside, { key: "Tab" });

    const focusInDialog = dialog.contains(document.activeElement);
    expect(focusInDialog).toBe(true);
  });
});

function TabsHarness(): React.JSX.Element {
  const [value, setValue] = useState("overview");
  return (
    <AppTabs value={value} onValueChange={setValue} aria-label="任务视图">
      <AppTabsList>
        <AppTabsTrigger value="overview">概览</AppTabsTrigger>
        <AppTabsTrigger value="detail">详情</AppTabsTrigger>
        <AppTabsTrigger value="log">日志</AppTabsTrigger>
      </AppTabsList>
      <div role="tabpanel" aria-label="概览面板" hidden={value !== "overview"} />
      <div role="tabpanel" aria-label="详情面板" hidden={value !== "detail"} />
      <div role="tabpanel" aria-label="日志面板" hidden={value !== "log"} />
    </AppTabs>
  );
}

describe("AppTabs", () => {
  it("keeps a single tab stop on the tablist", () => {
    render(<TabsHarness />);
    const tablist = screen.getByRole("tablist");
    expect(tablist).toHaveAttribute("tabindex", "0");
    for (const name of ["概览", "详情", "日志"]) {
      expect(screen.getByRole("tab", { name })).toHaveAttribute("tabindex", "-1");
    }
    expect(screen.getByRole("tab", { name: "概览" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches with arrow keys and supports Home/End", async () => {
    render(<TabsHarness />);
    const overview = screen.getByRole("tab", { name: "概览" });
    overview.focus();

    act(() => {
      fireEvent.keyDown(overview, { key: "ArrowRight" });
    });
    await waitFor(() => expect(screen.getByRole("tab", { name: "详情" })).toHaveAttribute("aria-selected", "true"));
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "详情" }));

    act(() => {
      fireEvent.keyDown(screen.getByRole("tab", { name: "详情" }), { key: "End" });
    });
    await waitFor(() => expect(screen.getByRole("tab", { name: "日志" })).toHaveAttribute("aria-selected", "true"));

    act(() => {
      fireEvent.keyDown(screen.getByRole("tab", { name: "日志" }), { key: "Home" });
    });
    await waitFor(() => expect(screen.getByRole("tab", { name: "概览" })).toHaveAttribute("aria-selected", "true"));
  });
});

interface SampleRow {
  id: string;
  name: string;
  status: string | null;
}

const sampleColumns: Array<DataTableColumn<SampleRow>> = [
  { key: "name", header: "名称" },
  { key: "status", header: "状态" },
];

const sampleRows: SampleRow[] = [
  { id: "row-1", name: "Codex", status: "available" },
  { id: "row-2", name: "Claude", status: null },
];

function renderTable(): void {
  render(
    <DataTable
      ariaLabel="适配器状态"
      columns={sampleColumns}
      rows={sampleRows}
      getRowId={(row) => row.id}
      getValue={(row, key) => row[key as keyof SampleRow]}
    />,
  );
}

describe("DataTable", () => {
  it("has an accessible name, column headers, and cells", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "适配器状态" });
    expect(table).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["名称", "状态"]);
    expect(screen.getAllByRole("cell").map((c) => c.textContent)).toEqual(["Codex", "available", "Claude", "未提供"]);
  });

  it("never renders an empty cell or a dash placeholder", () => {
    render(
      <DataTable
        ariaLabel="空值表"
        columns={[
          { key: "name", header: "名称" },
          { key: "status", header: "状态", emptyText: "尚未检查" },
        ]}
        rows={[{ id: "row-1", name: "", status: undefined }]}
        getRowId={(row) => row.id}
        getValue={(row, key) => row[key as keyof SampleRow]}
      />,
    );
    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["未提供", "尚未检查"]);
    for (const text of cells) {
      expect(text!.trim().length).toBeGreaterThan(0);
      expect(text).not.toBe("—");
    }
  });
});

describe("PageState", () => {
  it("announces loading while keeping the region busy", () => {
    render(<PageLoading label="正在加载任务" />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("正在加载任务")).toBeInTheDocument();
  });

  it("offers exactly one recovery action for an empty list", async () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        title="还没有项目"
        description="创建第一个项目后即可开始派工。"
        action={{ label: "创建项目", onAction }}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("offers exactly one retry action for errors", async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState title="加载失败" description="网络请求未完成。" action={{ label: "重试", onAction: onRetry }} />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("explains what is missing without blocking the rest", () => {
    render(
      <PartialState title="部分事实暂缺" description="文件变化扫描未完成，其余内容仍可查看。">
        <p>已加载的事件</p>
      </PartialState>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("文件变化扫描未完成");
    expect(screen.getByText("已加载的事件")).toBeInTheDocument();
  });
});

describe("Feedback", () => {
  it("keeps a status banner visible with its recovery entry", () => {
    const onRecover = vi.fn();
    render(
      <StatusBanner
        tone="warning"
        title="执行已中断"
        description="服务器重启导致 Run 停止。"
        action={{ label: "恢复执行", onAction: onRecover }}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("执行已中断");
    fireEvent.click(screen.getByRole("button", { name: "恢复执行" }));
    expect(onRecover).toHaveBeenCalledOnce();
  });

  it("announces transient confirmations and clears them", () => {
    vi.useFakeTimers();
    function Harness(): React.JSX.Element {
      const feedback = useTransientFeedback();
      return (
        <>
          <button type="button" onClick={() => feedback.notify("已取消排队")}>
            取消
          </button>
          <TransientFeedback feedback={feedback} />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("status")).toHaveTextContent("已取消排队");
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("renders a disabled action with its visible reason", () => {
    render(
      <DisabledAction reason="没有可用的验证 adapter，先在运行时完成配置。">
        <button type="button" disabled>
          触发验证
        </button>
      </DisabledAction>,
    );
    expect(screen.getByRole("button", { name: "触发验证" })).toBeDisabled();
    expect(screen.getByText("没有可用的验证 adapter，先在运行时完成配置。")).toBeInTheDocument();
  });
});
