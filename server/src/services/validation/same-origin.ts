import type { AdapterIdentitySnapshot } from "@personahub/shared/types";

export function isSameOriginValidation(
  implementationIdentity: AdapterIdentitySnapshot,
  validatorIdentity: AdapterIdentitySnapshot,
): boolean {
  return (
    implementationIdentity.cli_provider === validatorIdentity.cli_provider &&
    implementationIdentity.default_model === validatorIdentity.default_model
  );
}

export function sameOriginLabel(sameOrigin: boolean): string {
  return sameOrigin ? "Same-origin validation" : "Independent validation";
}

export function describeIdentityDifference(
  implementationIdentity: AdapterIdentitySnapshot,
  validatorIdentity: AdapterIdentitySnapshot,
): string {
  const diffs: string[] = [];
  if (implementationIdentity.cli_provider !== validatorIdentity.cli_provider) {
    diffs.push(
      `cli_provider: implementation=${implementationIdentity.cli_provider}, validator=${validatorIdentity.cli_provider}`,
    );
  }
  if (implementationIdentity.default_model !== validatorIdentity.default_model) {
    diffs.push(
      `default_model: implementation=${implementationIdentity.default_model ?? "N/A"}, validator=${validatorIdentity.default_model ?? "N/A"}`,
    );
  }
  return diffs.join("; ");
}
