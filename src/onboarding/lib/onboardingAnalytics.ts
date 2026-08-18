/**
 * Minimal first-party onboarding funnel.
 *
 * Product decision: do NOT add a new analytics/telemetry vendor for this
 * feature. In development we emit a dev-only trace (consistent with the existing
 * `logAuthTrace` diagnostics). In production this is a no-op UNLESS a backend
 * callable is later wired in — and even then it must post only non-PII props
 * (step, authProvider, hadChild, taskTemplate). Names and emails are never sent.
 */

export type OnboardingEvent =
  | 'onboarding_started'
  | 'onboarding_parent_named'
  | 'onboarding_child_named'
  | 'onboarding_demo_seen'
  | 'onboarding_auth_started'
  | 'onboarding_auth_completed'
  | 'onboarding_family_created'
  | 'onboarding_first_task_created'
  | 'onboarding_completed';

/** Non-PII properties only. Never include names, emails, or tokens. */
export type OnboardingProps = Record<string, string | number | boolean | undefined>;

function emit(name: OnboardingEvent, props?: OnboardingProps): void {
  if (import.meta.env?.PROD) return;
  // eslint-disable-next-line no-console
  console.info(`[auth-trace] onboarding:${name}`, props ?? {});
}

export function recordOnboardingEvent(name: OnboardingEvent, props?: OnboardingProps): void {
  emit(name, props);
}
