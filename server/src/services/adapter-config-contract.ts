import type { AgentCapability } from "@personahub/shared/types";
import { AdapterAuthType, CliProvider } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../api/errors.js";
import { resolveExecutable } from "../runtime/executable-resolver.js";
import {
  PROVIDER_SUPPORTED_AUTH_TYPES,
  isKnownModelProvider,
  isValidCliProvider,
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

export function validateCommand(command: string): { available: boolean; errorMessage: string | null } {
  if (!command || !command.trim()) {
    return { available: false, errorMessage: "Command is empty." };
  }
  const { resolved, errorMessage: resolveError } = resolveExecutable(command);
  if (!resolved) {
    return { available: false, errorMessage: resolveError ?? `Command not found: ${command}` };
  }
  return { available: true, errorMessage: null };
}

export function validateAuthState(
  cliProvider: string,
  authType: AdapterAuthType,
  modelProvider: string | null,
  defaultModel: string | null,
  hasApiKey: boolean,
): void {
  if (!isValidCliProvider(cliProvider)) {
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
    if (cliProvider === CliProvider.OpenCode) {
      if (!modelProvider) {
        throw new AppError(
          ErrorCode.ADAPTER_AUTH_INVALID,
          "model_provider is required for opencode (needed to build -m provider/model).",
          "model_provider",
        );
      }
      if (!defaultModel) {
        throw new AppError(
          ErrorCode.ADAPTER_AUTH_INVALID,
          "default_model is required for opencode (needed to build -m provider/model).",
          "default_model",
        );
      }
    }
    return;
  }

  if (!modelProvider) {
    throw new AppError(
      ErrorCode.ADAPTER_AUTH_INVALID,
      "model_provider is required for API-key auth.",
      "model_provider",
    );
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
