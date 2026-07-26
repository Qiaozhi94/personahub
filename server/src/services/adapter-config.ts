import type Database from "better-sqlite3";
import type { AdapterConfig, AdapterStatus, AgentCapability, Workspace } from "@personahub/shared/types";
import { AdapterStatus as AS, AdapterAuthType, CliProvider } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import { deriveRole } from "../repositories/agent-config.js";
import { toPublicAdapter } from "../repositories/agent-config-dto.js";
import type { ProjectRepository } from "../repositories/project.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { AdapterWorkspaceStatusRepository } from "../repositories/adapter-workspace-status.js";
import { AdapterAvailabilityProbeCoordinator } from "./adapter-probe-coordinator.js";
import type { AgentAdapterRegistry } from "../runtime/adapter-registry.js";
import { AppError } from "../api/errors.js";
import { resolveExecutable } from "../runtime/executable-resolver.js";
import { sanitizeAuthStatusMessage } from "../runtime/trace/redaction.js";
import { effectiveAdapterStatus } from "./adapter-availability.js";
import {
  PROVIDER_SUPPORTED_AUTH_TYPES,
  isValidCliProvider,
  isKnownModelProvider,
} from "../runtime/provider-metadata.js";

export interface AdapterConfigCreateServiceInput {
  name: string;
  cli_provider: string;
  command: string;
  args?: string[];
  default_model?: string;
  auth_type?: AdapterAuthType;
  model_provider?: string;
  api_key?: string;
  capability_tags?: AgentCapability[];
  make_default?: boolean;
}

export interface AdapterConfigUpdateServiceInput {
  name?: string;
  command?: string;
  args?: string[];
  default_model?: string | null;
  auth_type?: AdapterAuthType;
  model_provider?: string | null;
  /** omitted preserves; null clears; non-empty string replaces; trimmed-empty is rejected. */
  api_key?: string | null;
  capability_tags?: AgentCapability[];
}

/**
 * final-recheck-report fix: this used to also `spawnSync(["--version"])`
 * with a 10s timeout — a synchronous child-process call sitting directly in
 * the Fastify request path, blocking the entire single-threaded Node event
 * loop (every other API/SSE/queue-orchestration request) for however long
 * the CLI took to respond. A real full-suite run under load actually hit
 * this and timed out the create route. `resolveExecutable()` alone is
 * synchronous but fast (no subprocess) — it only confirms the command
 * *resolves* to a real file, not that it runs/authenticates successfully;
 * that stronger check belongs solely to the already-async, explicit
 * `adapter.validate()` path (AdapterConfigService.validate()), never here.
 */
function validateCommand(command: string): { available: boolean; errorMessage: string | null } {
  if (!command || !command.trim()) {
    return { available: false, errorMessage: "Command is empty." };
  }
  const { resolved, errorMessage: resolveError } = resolveExecutable(command);
  if (!resolved) {
    return { available: false, errorMessage: resolveError ?? `Command not found: ${command}` };
  }
  return { available: true, errorMessage: null };
}

/**
 * Validates the effective (post-merge) auth state for a given provider.
 * Shared by create (effective = input) and update (effective = existing
 * record merged with the requested changes) so the two paths can never
 * silently diverge on what "a valid auth configuration" means.
 */
function validateAuthState(
  cliProvider: string,
  authType: AdapterAuthType,
  modelProvider: string | null,
  defaultModel: string | null,
  hasApiKey: boolean,
): void {
  if (!isValidCliProvider(cliProvider)) {
    // Caller already checked provider support separately; this is defense-in-depth.
    throw new AppError(ErrorCode.ADAPTER_PROVIDER_UNSUPPORTED, `Unsupported provider: ${cliProvider}.`);
  }
  const supportedAuthTypes = PROVIDER_SUPPORTED_AUTH_TYPES[cliProvider];
  if (!supportedAuthTypes.includes(authType)) {
    throw new AppError(
      ErrorCode.ADAPTER_AUTH_INVALID,
      `Provider ${cliProvider} does not support auth_type=${authType}. Supported: ${supportedAuthTypes.join(", ")}.`,
      "auth_type",
    );
  }

  if (authType === AdapterAuthType.OAuth) {
    if (hasApiKey) {
      throw new AppError(ErrorCode.ADAPTER_AUTH_INVALID, "OAuth adapters cannot also carry an api_key.", "api_key");
    }
    // design §6.4 (opencode-protocol-fixtures.md T005): omitting `-m
    // <provider>/<model>` lets OpenCode silently fall back to a free model
    // instead of failing — this is unrelated to auth_type, so OAuth-mode
    // OpenCode needs model_provider/default_model too, just without the
    // api-key allowlist restriction (any non-empty provider string; real
    // validity is confirmed by validate()'s actual probe call, not a
    // client-side enum).
    if (cliProvider === CliProvider.OpenCode) {
      if (!modelProvider) {
        throw new AppError(ErrorCode.ADAPTER_AUTH_INVALID, "model_provider is required for opencode (needed to build -m provider/model).", "model_provider");
      }
      if (!defaultModel) {
        throw new AppError(ErrorCode.ADAPTER_AUTH_INVALID, "default_model is required for opencode (needed to build -m provider/model).", "default_model");
      }
    }
    return;
  }

  // ApiKey mode (only reachable for providers that support it, e.g. opencode).
  if (!modelProvider) {
    throw new AppError(ErrorCode.ADAPTER_AUTH_INVALID, "model_provider is required for API-key auth.", "model_provider");
  }
  if (!defaultModel) {
    throw new AppError(ErrorCode.ADAPTER_AUTH_INVALID, "default_model is required for API-key auth.", "default_model");
  }
  if (!hasApiKey) {
    throw new AppError(ErrorCode.ADAPTER_API_KEY_REQUIRED, "api_key is required for API-key auth.", "api_key");
  }
  if (!isKnownModelProvider(modelProvider)) {
    throw new AppError(
      ErrorCode.ADAPTER_MODEL_PROVIDER_UNSUPPORTED,
      `model_provider "${modelProvider}" is not a verified provider.`,
      "model_provider",
    );
  }
}

export class AdapterConfigService {
  /**
   * final-recheck-3-report AC-001 fix: create/update no longer claim
   * `Available` off a bare command-resolution check — only a real,
   * async provider auth probe (`validate()`) may. Tracked (not fully
   * unmanaged fire-and-forget) for the same reason as RunDispatchService's
   * re-probe: shutdown() can wait for it (bounded), and a throw is logged
   * instead of silently swallowed.
   */
  private pendingAvailabilityProbes = new Set<Promise<void>>();

  constructor(
    private agentConfigRepo: AgentConfigRepository,
    private projectRepo: ProjectRepository,
    private adapterRegistry: AgentAdapterRegistry,
    private workspaceRepo: WorkspaceRepository,
    private adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository,
    private db: Database.Database,
    /**
     * closure-recheck-3-report fix: SHARED with `RunDispatchService`
     * (single injected instance, wired in index.ts/tests/helpers.ts) —
     * generation-based probe ordering only prevents "whichever write lands
     * first wins" races if EVERY writer of a probe result claims/checks the
     * SAME coordinator. A private-to-this-service Map (the previous round's
     * design) still let `RunDispatchService.reprobeAdapterOnFailure()` — a
     * second, independent writer to the same `adapter_workspace_status`
     * rows — silently beat a newer explicit Validate to the write, since it
     * never claimed a generation here at all. See
     * adapter-probe-coordinator.ts for the full design rationale.
     */
    private probeCoordinator: AdapterAvailabilityProbeCoordinator,
  ) {}

  private trackAvailabilityProbe(probe: Promise<void>): void {
    this.pendingAvailabilityProbes.add(probe);
    void probe
      .catch((error) => {
        console.warn("[AdapterConfigService] auto-validate after create/update failed:", error);
      })
      .finally(() => {
        this.pendingAvailabilityProbes.delete(probe);
      });
  }

  /** Mirrors RunDispatchService.shutdown() — called from the same onClose hook. */
  async shutdown(timeoutMs = 5_000): Promise<void> {
    if (this.pendingAvailabilityProbes.size === 0) return;
    const pending = Promise.allSettled([...this.pendingAvailabilityProbes]);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    await Promise.race([pending, timeout]);
  }

  /**
   * `Unknown` (a resolvable command) can't safely auto-become the Project
   * default or drive routing on its own — but silently leaving it at
   * Unknown forever, requiring a manual Validate click, would make
   * "create an adapter" feel broken compared to the old (wrong) "instantly
   * Available" behavior. This closes the loop in the background: probe for
   * real, and only then — if it actually confirms Available — apply the
   * default-adapter assignment the synchronous create() call deferred.
   *
   * closure-check-report fix: `defaultAtCreate` is the Project's
   * `default_adapter_config_id` as it stood at create() time, snapshotted
   * before this background probe was kicked off. The deferred default
   * assignment below only applies if the Project's default is STILL that
   * same snapshot by the time the (possibly slow) probe resolves — a user
   * who explicitly picked a different default in the meantime made a newer,
   * more specific choice than this create() call's original (possibly
   * implicit) intent, and that choice must win, not get silently clobbered
   * by a probe that started before it happened.
   */
  private async autoValidateAfterCreate(adapterId: string, projectId: string, tryMakeDefault: boolean, defaultAtCreate: string | null): Promise<void> {
    let validated: AdapterConfig;
    try {
      validated = await this.validate(adapterId);
    } catch {
      return; // e.g. deleted mid-flight, or registry lookup failed — nothing to converge.
    }
    if (validated.status !== AS.Available) return;

    const project = this.projectRepo.getById(projectId);
    if (!project) return;
    if ((tryMakeDefault || defaultAtCreate === null) && project.default_adapter_config_id === defaultAtCreate) {
      this.projectRepo.setDefaultAdapter(projectId, adapterId);
    }
  }

  /** update()'s equivalent — no default-adapter logic (that's the separate, explicit setDefault()/PUT default-adapter endpoint). */
  private async autoValidateAfterUpdate(adapterId: string): Promise<void> {
    try {
      await this.validate(adapterId);
    } catch {
      // e.g. deleted mid-flight, or registry lookup failed — nothing to converge.
    }
  }

  create(projectId: string, input: AdapterConfigCreateServiceInput): AdapterConfig {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }

    const trimmedName = input.name?.trim();
    if (!trimmedName) {
      throw new AppError(ErrorCode.ADAPTER_COMMAND_REQUIRED, "Adapter name is required.", "name");
    }

    if (!isValidCliProvider(input.cli_provider)) {
      throw new AppError(ErrorCode.ADAPTER_PROVIDER_UNSUPPORTED, `Unsupported provider: ${input.cli_provider}.`);
    }

    const trimmedCommand = input.command?.trim();
    if (!trimmedCommand) {
      throw new AppError(ErrorCode.ADAPTER_COMMAND_REQUIRED, "Command is required.", "command");
    }

    const authType = input.auth_type ?? AdapterAuthType.OAuth;
    const modelProvider = input.model_provider?.trim() || null;
    const defaultModel = input.default_model?.trim() || null;
    const apiKey = input.api_key?.trim() || null;

    validateAuthState(input.cli_provider, authType, modelProvider, defaultModel, apiKey !== null);

    // capability_tags defaults to [implementation] — F002/F004's create path
    // never leave this hardcoded empty; an omitted value must still produce a
    // usable adapter, matching the historical single-role default. Only an
    // *omitted* field gets this compatibility default — an explicitly empty
    // array is a valid, meaningful state (design §7.2 rule 6: no capability
    // means consult-only, in any Issue status) and must be preserved as-is,
    // not silently upgraded to implementation.
    const capabilityTags: AgentCapability[] = input.capability_tags === undefined
      ? (["implementation"] as AgentCapability[])
      : input.capability_tags;
    const role = deriveRole(capabilityTags);

    // AC-001 fix: a resolvable command is `Unknown`, never `Available` —
    // resolving to a real file proves the binary exists, not that its
    // account is logged in / its API key works. Only validate()'s real
    // provider probe (kicked off async below) may promote this to
    // Available.
    const validation = validateCommand(trimmedCommand);
    const status: AdapterStatus = validation.available ? AS.Unknown : AS.Unavailable;

    const record = this.agentConfigRepo.create({
      project_id: projectId,
      name: trimmedName,
      role,
      cli_provider: input.cli_provider,
      command: trimmedCommand,
      args: input.args ?? [],
      capability_tags: capabilityTags,
      default_model: defaultModel,
      status,
      auth_type: authType,
      model_provider: modelProvider,
      api_key: apiKey,
      auth_status_message: null,
    });

    // Unknown never auto-becomes the Project default at creation time — see
    // autoValidateAfterCreate(), which applies design §4.1's "first
    // available adapter becomes default" / explicit make_default rule only
    // once a real probe actually confirms Available.
    if (status === AS.Unknown) {
      this.trackAvailabilityProbe(this.autoValidateAfterCreate(record.id, projectId, input.make_default === true, project.default_adapter_config_id));
    }

    return toPublicAdapter(record, project.default_adapter_config_id);
  }

  /**
   * closure-check-report fix: `workspaceId` lets a caller ask "what does
   * this Project's adapters actually look like FROM this workspace" — the
   * missing half of the workspace-aware availability model, which until now
   * only affected `validate()`/routing/validator-selection server-side with
   * no way for the UI to observe it. Omitted: identical to the old
   * behavior (global-only DTOs, no `effective_*`/`has_workspace_override`
   * fields at all, so existing callers are unaffected). Provided but
   * invalid/cross-Project: `WORKSPACE_NOT_FOUND`, matching `validate()`'s
   * same distinction between "omitted" and "invalid" (never silently
   * degrades to the unscoped view).
   */
  list(projectId: string, workspaceId?: string): AdapterConfig[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }
    const records = this.agentConfigRepo.listByProject(projectId);

    if (workspaceId === undefined) {
      return records.map((r) => toPublicAdapter(r, project.default_adapter_config_id));
    }

    const workspace = this.workspaceRepo.getById(workspaceId);
    if (!workspace || workspace.project_id !== projectId) {
      throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found for this Project.");
    }
    const overrideByAdapterId = new Map(
      this.adapterWorkspaceStatusRepo.listForWorkspace(workspaceId).map((o) => [o.adapter_config_id, o]),
    );
    return records.map((r) => {
      const override = overrideByAdapterId.get(r.id) ?? null;
      return {
        ...toPublicAdapter(r, project.default_adapter_config_id),
        effective_status: effectiveAdapterStatus(r, override),
        effective_last_checked_at: override?.last_checked_at ?? r.last_checked_at,
        effective_auth_status_message: override?.auth_status_message ?? r.auth_status_message,
        has_workspace_override: override !== null,
      };
    });
  }

  getById(id: string): AdapterConfig {
    const record = this.agentConfigRepo.getById(id);
    if (!record) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }
    const project = this.projectRepo.getById(record.project_id);
    return toPublicAdapter(record, project?.default_adapter_config_id ?? null);
  }

  update(id: string, input: AdapterConfigUpdateServiceInput): AdapterConfig {
    const existing = this.agentConfigRepo.getById(id);
    if (!existing) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }

    const updates: {
      name?: string;
      role?: string;
      command?: string;
      args?: string[];
      capability_tags?: AgentCapability[];
      default_model?: string | null;
      status?: AdapterStatus;
      last_checked_at?: string | null;
      auth_status_message?: string | null;
      auth_type?: AdapterAuthType;
      model_provider?: string | null;
      api_key?: string | null;
      updated_at: string;
    } = { updated_at: new Date().toISOString() };

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) {
        throw new AppError(ErrorCode.ADAPTER_COMMAND_REQUIRED, "Adapter name cannot be empty.", "name");
      }
      updates.name = trimmed;
    }

    let effectiveCommand = existing.command;
    if (input.command !== undefined) {
      const trimmed = input.command.trim();
      if (!trimmed) {
        throw new AppError(ErrorCode.ADAPTER_COMMAND_REQUIRED, "Command cannot be empty.", "command");
      }
      updates.command = trimmed;
      effectiveCommand = trimmed;
    }

    if (input.args !== undefined) {
      updates.args = input.args;
    }

    if (input.default_model !== undefined) {
      updates.default_model = input.default_model?.trim() || null;
    }

    if (input.capability_tags !== undefined) {
      updates.capability_tags = input.capability_tags;
      updates.role = deriveRole(input.capability_tags);
    }

    // Resolve the effective api_key tri-state before touching auth_type, so
    // "switch auth_type oauth->api_key without a key" and "clear key while
    // staying in api_key mode" both surface as ADAPTER_API_KEY_REQUIRED via
    // the same validateAuthState() call below, not two different code paths.
    let effectiveApiKey = existing.api_key;
    if (input.api_key !== undefined) {
      if (input.api_key === null) {
        effectiveApiKey = null;
      } else {
        const trimmed = input.api_key.trim();
        if (!trimmed) {
          throw new AppError(ErrorCode.ADAPTER_API_KEY_REQUIRED, "api_key cannot be blank.", "api_key");
        }
        effectiveApiKey = trimmed;
      }
      updates.api_key = effectiveApiKey;
    }

    const effectiveAuthType = input.auth_type ?? existing.auth_type;
    // design §5.1: switching to oauth always clears a stale key, even if the
    // caller didn't separately pass api_key:null — no dangling secret survives
    // an auth-mode switch.
    if (input.auth_type !== undefined && input.auth_type === AdapterAuthType.OAuth) {
      effectiveApiKey = null;
      updates.api_key = null;
    }

    const effectiveModelProvider = input.model_provider !== undefined
      ? (input.model_provider?.trim() || null)
      : existing.model_provider;
    if (input.model_provider !== undefined) {
      updates.model_provider = effectiveModelProvider;
    }

    const effectiveDefaultModel = updates.default_model !== undefined ? updates.default_model : existing.default_model;

    const authRelatedFieldsTouched =
      input.auth_type !== undefined ||
      input.model_provider !== undefined ||
      input.api_key !== undefined ||
      input.default_model !== undefined;

    // design §4.2: explicitly clearing api_key (input.api_key === null) is a
    // deliberate degrade, not an error — "清空并令 API-key adapter
    // unavailable" — as long as the caller isn't ALSO actively choosing to
    // (re)enter api_key mode in the same call. Switching auth_type itself
    // still goes through the strict check below, same as create.
    const isExplicitKeyClearOnly = input.api_key === null && input.auth_type === undefined;

    if (authRelatedFieldsTouched && !isExplicitKeyClearOnly) {
      validateAuthState(existing.cli_provider, effectiveAuthType, effectiveModelProvider, effectiveDefaultModel, effectiveApiKey !== null);
    }
    if (input.auth_type !== undefined) {
      updates.auth_type = effectiveAuthType;
    }

    // closure-recheck-report fix: ONE unified invalidation covering every
    // field that can change what a real probe would find — command/args/
    // auth_type/api_key/model_provider/default_model — computed once here,
    // not scattered per-field. The scattered version this replaces missed
    // `args`: it deleted the workspace override below but never touched
    // the GLOBAL `status`, so an `args`-only edit left the old (unverified
    // under the new args) `Available` standing and fully routable.
    const availabilityRelevantFieldsTouched =
      input.command !== undefined ||
      input.args !== undefined ||
      input.auth_type !== undefined ||
      input.api_key !== undefined ||
      input.model_provider !== undefined ||
      input.default_model !== undefined;

    if (isExplicitKeyClearOnly && effectiveAuthType === AdapterAuthType.ApiKey) {
      // Key is gone but the adapter stays in api_key mode: it's now unusable
      // until a new key is set, but that is a status change, not a rejection.
      // No probe follows — a missing key can't possibly validate.
      updates.status = AS.Unavailable;
      updates.last_checked_at = new Date().toISOString();
    } else if (availabilityRelevantFieldsTouched) {
      // AC-001 fix: a resolvable command is Unknown, not Available — this
      // covers `command` itself changing AND every other
      // availability-relevant field changing while `command` didn't (using
      // the now-effective command either way). `last_checked_at`/
      // `auth_status_message` are cleared, not left stale, since command
      // resolvability alone is not the auth probe that produced whatever
      // they currently hold.
      const resolution = validateCommand(effectiveCommand);
      updates.status = resolution.available ? AS.Unknown : AS.Unavailable;
      updates.last_checked_at = null;
      updates.auth_status_message = null;
    }

    // closure-recheck-report fix: these two writes must be all-or-nothing —
    // a process exit or SQLite error between them would otherwise leave
    // "new config + stale workspace override" permanently on disk (the
    // resolver would keep consuming that stale override after restart).
    this.db.transaction(() => {
      this.agentConfigRepo.update(id, updates);
      if (availabilityRelevantFieldsTouched) {
        this.adapterWorkspaceStatusRepo.deleteForAdapter(id);
      }
    })();
    // closure-recheck-2/3-report fix: any probe already in flight against
    // the OLD config — in this service OR in RunDispatchService's failure
    // re-probe — must be recognized as stale.
    if (availabilityRelevantFieldsTouched) {
      this.probeCoordinator.invalidateAdapter(id);
    }
    const record = this.agentConfigRepo.getById(id)!;
    const project = this.projectRepo.getById(record.project_id);

    // Unknown means "resolvable but not (re)confirmed" — kick off a real
    // probe in the background so an auth-relevant edit converges back to a
    // true Available/Unavailable without the caller needing to separately
    // click Validate (mirrors autoValidateAfterCreate()'s create-time
    // convergence, minus the default-adapter assignment, which update()
    // never touches).
    if (updates.status === AS.Unknown) {
      this.trackAvailabilityProbe(this.autoValidateAfterUpdate(id));
    }

    return toPublicAdapter(record, project?.default_adapter_config_id ?? null);
  }

  /**
   * design §9.2: adapter must belong to the same Project and be Available;
   * `adapterId: null` only succeeds when the Project has no adapters left —
   * a Project with adapters is never allowed to sit in an implicit,
   * unset-default state (that's a UX trap, not a valid configuration).
   */
  setDefault(projectId: string, adapterId: string | null): AdapterConfig | null {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }

    if (adapterId === null) {
      const existingAdapters = this.agentConfigRepo.listByProject(projectId);
      if (existingAdapters.length > 0) {
        throw new AppError(
          ErrorCode.ADAPTER_REQUIRED,
          "Cannot clear the default adapter while the Project still has adapters. Set a different default first.",
        );
      }
      this.projectRepo.clearDefaultAdapter(projectId);
      return null;
    }

    const result = this.projectRepo.setDefaultAdapter(projectId, adapterId);
    if (!result.success) {
      if (result.reason === "unavailable") {
        throw new AppError(ErrorCode.ADAPTER_UNAVAILABLE, "Adapter is not available.");
      }
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found for this project.");
    }

    const record = this.agentConfigRepo.getById(adapterId)!;
    return toPublicAdapter(record, adapterId);
  }

  delete(id: string): void {
    const existing = this.agentConfigRepo.getById(id);
    if (!existing) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }

    if (this.agentConfigRepo.hasRuns(id)) {
      throw new AppError(ErrorCode.ADAPTER_IN_USE, "Cannot delete adapter config that has runs.");
    }

    const project = this.projectRepo.getById(existing.project_id);
    const isCurrentDefault = project?.default_adapter_config_id === id;
    if (isCurrentDefault) {
      const siblingCount = this.agentConfigRepo.listByProject(existing.project_id).length;
      if (siblingCount > 1) {
        throw new AppError(
          ErrorCode.ADAPTER_IN_USE,
          "Cannot delete the Project's default adapter while other adapters exist. Set a different default first.",
        );
      }
    }

    this.db.transaction(() => {
      if (isCurrentDefault) {
        // Only adapter left: allow delete, but clear the now-dangling default first.
        this.projectRepo.clearDefaultAdapter(existing.project_id);
      }
      // No ON DELETE CASCADE on adapter_workspace_status's FK — an adapter
      // with workspace overrides would otherwise fail this delete outright.
      this.adapterWorkspaceStatusRepo.deleteForAdapter(id);
      this.agentConfigRepo.delete(id);
    })();
    // closure-recheck-3-report fix: drop this adapter's generation entries
    // only after the delete transaction actually committed — a long-lived
    // server process would otherwise accumulate unbounded Map entries for
    // adapters that no longer exist (Low finding; not a correctness bug,
    // but an unbounded structure not worth leaving in place once noticed).
    this.probeCoordinator.forgetAdapter(id);
  }

  /**
   * T034: delegates to the registered adapter's own `validate()` — never a
   * hardcoded `--version` check. This is what lets each provider's real auth
   * probe (e.g. Claude's `auth status`, confirmed non-equivalent to
   * `--version` in Phase 1) actually determine availability.
   *
   * `workspaceId` is optional: adapter configs are Project-scoped, not
   * bound to one workspace, and a Project's workspaces can have different
   * `push_credentials_enabled` settings.
   *
   * - Omitted: the conservative credential-isolated assumption is probed,
   *   and the result is written to the Project-global `agent_configs.status`
   *   — the baseline every workspace falls back to when it has no override
   *   (schema v7 `adapter_workspace_status`; see adapter-availability.ts).
   * - Provided but not found, or belonging to a different Project:
   *   closure-check-report fix — this is now a hard `WORKSPACE_NOT_FOUND`
   *   error, not a silent fallback to the global-baseline path. "Omitted"
   *   and "invalid" are different caller intents (implicit conservative
   *   probe vs. a specific, mistyped/cross-Project scoped request) and must
   *   not share a code path — silently promoting an invalid scoped request
   *   into a global write let a typo'd/foreign workspace_id unexpectedly
   *   change the Project-wide baseline instead of erroring.
   * - A real workspace belonging to this Project: that workspace's actual
   *   dispatch environment (`push_credentials_enabled`) is probed instead
   *   (design §5.4 — OpenCode OAuth on Windows is only reachable when the
   *   target workspace skips isolation), and the result is written as an
   *   EXCEPTION for that one `(adapter_config_id, workspace_id)` pair only
   *   — and only if it actually differs from the (freshly re-read) global
   *   baseline; a scoped result that matches the baseline deletes any
   *   stale override instead of upserting a redundant one, keeping the
   *   table exception-only as schema-v7.ts documents. The Project-global
   *   status is never touched by a workspace-scoped probe — a permissive
   *   workspace's success must not silently make the adapter look Available
   *   to the Project's other (isolated) workspaces, and a workspace-specific
   *   failure must not disable it for them either.
   *
   * closure-recheck-2/3-report fix: staleness is now judged by two
   * in-process generation counters on the SHARED `probeCoordinator` (also
   * injected into `RunDispatchService`, whose failure re-probe writes to
   * the exact same `adapter_workspace_status` rows — a coordinator private
   * to this service alone still let that second writer silently beat a
   * newer explicit Validate to the write), not a DB-persisted CAS column.
   * The DB-column attempt this replaces had two real problems: (1) it was
   * added by amending an already-shipped schema version, so any database
   * that had already migrated through the column-less original would never
   * gain the column ("no such column" at runtime) — migrations must be
   * immutable once they can have run; and (2) it only implemented
   * "whichever probe's WRITE lands first wins" — an older, already-in-flight
   * auto-probe could
   * still beat a user's brand-new, explicit Validate click to the write,
   * even though the click represents strictly newer intent. Claiming a
   * generation at CALL START (not at write time) and checking it's still
   * the latest before writing fixes both: nothing to migrate, and "the most
   * recently invoked validate() for this exact scope wins" regardless of
   * completion order. The workspace-scoped path additionally still
   * snapshots the override row's own `updated_at` (a second, narrower probe
   * — e.g. `RunDispatchService.reprobeAdapterOnFailure()` — can write there
   * without ever going through this method's generation map) and the
   * target workspace's `push_credentials_enabled` specifically (not the
   * whole `updated_at`, which also moves on unrelated writes like acquiring
   * a workspace lock or updating its detected git branch).
   */
  async validate(id: string, workspaceId?: string): Promise<AdapterConfig> {
    const existing = this.agentConfigRepo.getById(id);
    if (!existing) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }

    let workspace: Workspace | null = null;
    if (workspaceId !== undefined) {
      workspace = this.workspaceRepo.getById(workspaceId);
      if (!workspace || workspace.project_id !== existing.project_id) {
        throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found for this adapter's Project.");
      }
    }
    const scopedToWorkspace = workspace !== null;
    const probeScopeKey = scopedToWorkspace ? AdapterAvailabilityProbeCoordinator.scopedProbeKey(id, workspace!.id) : id;

    const snapshotConfigGeneration = this.probeCoordinator.getConfigGeneration(id);
    const myProbeGeneration = this.probeCoordinator.claimProbe(probeScopeKey);
    const overrideSnapshot = scopedToWorkspace ? this.adapterWorkspaceStatusRepo.get(id, workspace!.id) : null;
    const snapshotOverrideUpdatedAt = overrideSnapshot?.updated_at ?? null;
    const snapshotPushCredentialsEnabled = scopedToWorkspace ? workspace!.push_credentials_enabled : false;

    const project = this.projectRepo.getById(existing.project_id);
    const publicConfig = toPublicAdapter(existing, project?.default_adapter_config_id ?? null);
    const adapter = this.adapterRegistry.getForConfig(publicConfig);
    const result = await adapter.validate(publicConfig, existing.api_key, { pushCredentialsEnabled: snapshotPushCredentialsEnabled });

    const status: AdapterStatus = result.available ? AS.Available : AS.Unavailable;
    const now = new Date().toISOString();
    const sanitizedMessage = sanitizeAuthStatusMessage(result.errorMessage, [existing.api_key]);

    const current = this.agentConfigRepo.getById(id);
    const configChanged = !current || this.probeCoordinator.getConfigGeneration(id) !== snapshotConfigGeneration;
    const supersededByNewerProbe = !this.probeCoordinator.isCurrentProbe(probeScopeKey, myProbeGeneration);
    if (configChanged || supersededByNewerProbe) {
      // Either the adapter's availability-relevant config was edited (or
      // the adapter was deleted) while this probe was in flight, or a
      // validate() call for this exact scope that was invoked MORE
      // RECENTLY than this one has already claimed the current generation
      // — regardless of which of the two probes actually finishes first,
      // this one's result must never be written.
      if (!current) return this.getById(id);
      const currentOverride = scopedToWorkspace ? this.adapterWorkspaceStatusRepo.get(id, workspace!.id) : null;
      return {
        ...toPublicAdapter(current, project?.default_adapter_config_id ?? null),
        status: scopedToWorkspace ? effectiveAdapterStatus(current, currentOverride) : current.status,
        last_checked_at: currentOverride?.last_checked_at ?? current.last_checked_at,
        auth_status_message: currentOverride?.auth_status_message ?? current.auth_status_message,
      };
    }

    if (scopedToWorkspace) {
      const currentWorkspace = this.workspaceRepo.getById(workspace!.id);
      const currentOverride = this.adapterWorkspaceStatusRepo.get(id, workspace!.id);
      const workspaceEnvChanged = !currentWorkspace || currentWorkspace.push_credentials_enabled !== snapshotPushCredentialsEnabled;
      const overrideChanged = (currentOverride?.updated_at ?? null) !== snapshotOverrideUpdatedAt;
      if (workspaceEnvChanged || overrideChanged) {
        // Either the workspace's own dispatch environment
        // (push_credentials_enabled) changed mid-flight — invalidating what
        // this probe's result actually means — or a write outside this
        // method's own generation tracking (a cross-service write, e.g.
        // RunDispatchService.reprobeAdapterOnFailure()) already landed for
        // this exact pair. Either way, discard this stale result and
        // report the current effective state.
        return {
          ...toPublicAdapter(current, project?.default_adapter_config_id ?? null),
          status: effectiveAdapterStatus(current, currentOverride),
          last_checked_at: currentOverride?.last_checked_at ?? current.last_checked_at,
          auth_status_message: currentOverride?.auth_status_message ?? current.auth_status_message,
        };
      }

      if (status === current.status) {
        // Matches the (still-current) global baseline — no exception to
        // record; drop any stale override instead of upserting a redundant
        // one, keeping the table exception-only.
        this.adapterWorkspaceStatusRepo.delete(id, workspace!.id);
      } else {
        this.adapterWorkspaceStatusRepo.upsert({
          adapter_config_id: id,
          workspace_id: workspace!.id,
          status,
          last_checked_at: now,
          auth_status_message: sanitizedMessage,
        });
      }
      // The Project-global column is deliberately untouched — return the
      // workspace-effective result directly rather than re-reading a row
      // that may or may not have just been written.
      return { ...toPublicAdapter(current, project?.default_adapter_config_id ?? null), status, auth_status_message: sanitizedMessage, last_checked_at: now };
    }

    this.agentConfigRepo.update(id, {
      status,
      last_checked_at: now,
      auth_status_message: sanitizedMessage,
      updated_at: now,
    });

    const record = this.agentConfigRepo.getById(id)!;
    return toPublicAdapter(record, project?.default_adapter_config_id ?? null);
  }
}
