import type { Thread, ThreadEvent } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { ThreadRepository } from "../repositories/thread.js";
import type { ThreadEventRepository } from "../repositories/thread-event.js";
import { AppError } from "../api/errors.js";

export class ThreadService {
  constructor(
    private threadRepo: ThreadRepository,
    private threadEventRepo: ThreadEventRepository,
  ) {}

  get(threadId: string): Thread {
    const thread = this.threadRepo.getById(threadId);
    if (!thread) {
      throw new AppError(ErrorCode.THREAD_NOT_FOUND, "Thread not found.");
    }
    return thread;
  }

  getEvents(threadId: string, afterEventId?: string): ThreadEvent[] {
    return this.threadEventRepo.listByThread(threadId, afterEventId);
  }
}
