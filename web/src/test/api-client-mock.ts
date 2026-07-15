import { ErrorCode } from "@personahub/shared";
import { vi } from "vitest";

export const apiClient = {
  projects: {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
  },
  workspaces: {
    bind: vi.fn(),
    getByProject: vi.fn(),
    getById: vi.fn(),
  },
  issues: {
    create: vi.fn(),
    listByProject: vi.fn(),
    get: vi.fn(),
  },
  threads: {
    get: vi.fn(),
    getEvents: vi.fn(),
  },
  adapters: {
    create: vi.fn(),
    listByProject: vi.fn().mockResolvedValue({ adapters: [] }),
    update: vi.fn(),
    delete: vi.fn(),
    validate: vi.fn(),
  },
  runs: {
    create: vi.fn(),
    get: vi.fn(),
    listByIssue: vi.fn().mockResolvedValue({ runs: [] }),
    cancel: vi.fn(),
  },
};

export const toApiError = vi.fn((error: unknown) => ({
  code: ErrorCode.INTERNAL_ERROR,
  message: error instanceof Error ? error.message : "Unknown error",
}));
