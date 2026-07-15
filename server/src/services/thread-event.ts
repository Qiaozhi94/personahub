import type { ThreadEvent, ThreadEventType, ActorType } from "@personahub/shared/types";
import type { ThreadEventRepository } from "../repositories/thread-event.js";
import type { EventBus } from "../runtime/event-bus.js";

export class ThreadEventService {
  constructor(
    private threadEventRepo: ThreadEventRepository,
    private eventBus: EventBus,
  ) {}

  write(
    threadId: string,
    type: ThreadEventType,
    actorType: ActorType,
    actorId: string | null,
    payload: Record<string, unknown>,
    evidenceRefs: string[] = [],
  ): ThreadEvent {
    return this.threadEventRepo.create({
      thread_id: threadId,
      type,
      actor_type: actorType,
      actor_id: actorId,
      payload,
      evidence_refs: evidenceRefs,
    });
  }

  broadcast(event: ThreadEvent): void {
    this.eventBus.publish(event);
  }

  writeAndBroadcast(
    threadId: string,
    type: ThreadEventType,
    actorType: ActorType,
    actorId: string | null,
    payload: Record<string, unknown>,
    evidenceRefs: string[] = [],
  ): ThreadEvent {
    const event = this.write(threadId, type, actorType, actorId, payload, evidenceRefs);
    this.broadcast(event);
    return event;
  }

  listByThread(threadId: string, afterEventId?: string): ThreadEvent[] {
    return this.threadEventRepo.listByThread(threadId, afterEventId);
  }
}
