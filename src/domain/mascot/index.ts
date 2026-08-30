/**
 * Public surface of the Mascot Engine.
 *
 * Anything that wants to participate in mascot behaviour imports from
 * here. Components never reach into internals — they read the resolved
 * presentation through `useMascotPresentation` and render `<Mascot />`.
 */

export type {
  MascotMood,
  MascotExpression,
  MascotAnimationId,
  MascotPresentation,
  MascotContext,
  ResolveMascotPresentationInput,
} from './types';

export {
  DEFAULT_MASCOT_PRESENTATION,
  MASCOT_THRESHOLDS,
} from './types';

export {
  resolveMascotPresentation,
  digestMascotContext,
  type MascotContextDigest,
} from './resolver';

export {
  MASCOT_MESSAGES,
  SUPPORTED_LOCALES,
  resolveMascotLocale,
  getMascotMessageVariants,
  formatMascotMessage,
  selectMascotMessage,
  listMascotMessages,
  describeMascotMessageKey,
  type MascotLocale,
  type MascotMessageVariables,
  type MascotMessageTemplate,
  type MascotMessageCatalog,
} from './messages';