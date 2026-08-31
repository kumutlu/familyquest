/**
 * Mascot message catalog — curated, deterministic, child-safe.
 *
 * Every mascot line a child ever sees lives here. There is NO runtime
 * AI generation, NO unbounded free-form text, and NO user content.
 *
 * Each template is keyed by `messageKey` (the same key the resolver
 * returns in `MascotPresentation.messageKey`). For each key we provide
 * an array of variants per supported locale. The variant selection is
 * deterministic — the renderer picks a stable index from the input
 * (e.g. displayName length, streak value, day of month), so the SAME
 * context always produces the SAME line. This keeps tone predictable
 * for parents and operators reviewing the UI.
 *
 * Style rules
 * -----------
 *   - Allowed: playful, theatrical, cheeky.
 *   - Disallowed: guilt, shame, fear, threats, financial pressure,
 *     "you disappointed me", "I'm sad because of you", punishment
 *     for returning.
 *
 * Variable placeholders
 * ---------------------
 *   {{displayName}}   — the child's display name
 *   {{streak}}        — current streak in days (integer)
 *   {{questsRemaining}}— number of quests remaining today (integer)
 *
 * Adding a new locale
 * -------------------
 * Add a new key to `SUPPORTED_LOCALES` and a new entry to each
 * `MASCOT_MESSAGES` value. The engine fails safe to `en` if the
 * requested locale is missing.
 */

import type { MascotMood } from './types';

/* -------------------------------------------------------------------------- */
/* Locale + interpolation                                                     */
/* -------------------------------------------------------------------------- */

export type MascotLocale = 'en' | 'tr';

export const SUPPORTED_LOCALES: readonly MascotLocale[] = Object.freeze(['en', 'tr']) as readonly MascotLocale[];

/**
 * Variables the engine interpolates. Everything else must be authored
 * by hand and reviewed. Unknown variables are left in the output verbatim
 * so the translator can see them — never silently dropped.
 */
export interface MascotMessageVariables {
  displayName?: string;
  streak?: number;
  questsRemaining?: number;
}

/* -------------------------------------------------------------------------- */
/* Template shapes                                                            */
/* -------------------------------------------------------------------------- */

export interface MascotMessageTemplate {
  /** i18n key — matches `MascotPresentation.messageKey`. */
  key: string;
  /** Mood the template is meant to express. */
  mood: MascotMood;
  /**
   * Ordered list of variants. The renderer picks one with a stable
   * index. Multiple variants prevent the same line repeating every
   * day for active children.
   */
  variants: string[];
}

/**
 * Per-locale catalog. Keys are stable; variants are tuned per locale.
 * Missing locales fall back to English.
 */
export type MascotMessageCatalog = Readonly<Record<MascotLocale, Readonly<Record<string, readonly string[]>>>>;

const buildCatalog = (): MascotMessageCatalog => {
  const en = {
    // ---- Default / friendly -------------------------------------------------
    'mascot.default.friendly': [
      "Hey {{displayName}}! Ready when you are.",
      "Hi {{displayName}}! Glad you're here.",
      "Welcome back, {{displayName}}.",
      "Hey {{displayName}} — small steps today, big streak tomorrow.",
    ],

    // ---- First meeting ------------------------------------------------------
    'mascot.first_meeting': [
      "Hi {{displayName}}! I'm Queki. We'll figure this out together.",
      "Welcome, {{displayName}}! I'm Queki. Let's start small.",
    ],

    // ---- Welcome back (explicit comeback) ----------------------------------
    'mascot.welcome_back.general': [
      "You're back! Perfect timing.",
      "Hey {{displayName}}! I was hoping you'd swing by.",
      "There you are, {{displayName}}! Welcome back.",
    ],

    // ---- Inactivity ---------------------------------------------------------
    'mascot.inactivity.short': [
      "Hmm… I haven't seen you much today.",
      "Where did you get to, {{displayName}}?",
      "You're quiet today — everything okay?",
    ],
    'mascot.inactivity.long': [
      "{{displayName}}! Where have you been?!",
      "Okay {{displayName}}… three whole days?!",
      "I was starting to think the cat stole you.",
    ],

    // ---- Streak at risk -----------------------------------------------------
    'mascot.streak.at_risk': [
      "{{streak}}-day streak on the line — quick one to keep it alive?",
      "Hey {{displayName}}, your {{streak}}-day streak is in danger!",
      "One little quest and your {{streak}}-day streak is safe.",
    ],

    // ---- Celebrations -------------------------------------------------------
    'mascot.celebrate.level_up': [
      "Wait… did you just LEVEL UP?!",
      "{{displayName}}, you're officially bigger!",
      "I felt that level-up from here. Wow!",
    ],
    'mascot.celebrate.all_quests_done': [
      "Wait… you finished ALL of them?!",
      "{{displayName}}! Every quest, done. I'm impressed.",
      "That's it. Every single quest. Show-off.",
    ],

    // ---- Time of day --------------------------------------------------------
    'mascot.time.morning': [
      "Morning, {{displayName}}. Coffee's on me. Sort of.",
      "Hi {{displayName}} — gentle start today.",
      "Good morning, {{displayName}}. Let's see what's up.",
    ],
    'mascot.time.evening': [
      "Late night, {{displayName}}? One tiny thing is plenty.",
      "Evening, {{displayName}}. Wind-down mode on.",
      "Hi {{displayName}} — soft landing before bed.",
    ],
  } as const;

  const tr = {
    'mascot.default.friendly': [
      "Selam {{displayName}}! Hazır olduğunda başlarız.",
      "Merhaba {{displayName}}! Burada olman güzel.",
      "Tekrar hoş geldin, {{displayName}}.",
      "Selam {{displayName}} — bugün küçük adımlar, yarın büyük seri.",
    ],

    'mascot.first_meeting': [
      "Merhaba {{displayName}}! Ben Queki. Bunu birlikte çözeriz.",
      "Hoş geldin {{displayName}}! Ben Queki. Küçükten başlayalım.",
    ],

    'mascot.welcome_back.general': [
      "Geri döndün! Tam zamanında.",
      "Selam {{displayName}}! Uğramanı umuyordum.",
      "İşte buradasın {{displayName}}! Tekrar hoş geldin.",
    ],

    'mascot.inactivity.short': [
      "Hmm… bugün seni pek göremedim.",
      "Nereye kayboldun, {{displayName}}?",
      "Bugün biraz sessizsin — her şey yolunda mı?",
    ],
    'mascot.inactivity.long': [
      "{{displayName}}! Nerelerdeydin?!",
      "Tamam {{displayName}}… tam üç gün mü?!",
      "Seni kedi kaçırmış sanıyordum.",
    ],

    'mascot.streak.at_risk': [
      "{{streak}} günlük serin tehlikede — canlandırmak için bir tanecik görev?",
      "Selam {{displayName}}, {{streak}} günlük serin tehlikede!",
      "Tek minicik görev ve {{streak}} günlük serin güvende.",
    ],

    'mascot.celebrate.level_up': [
      "Dur… şu an SEVİYE ATLADIN mı?!",
      "{{displayName}}, resmen büyüdün!",
      "Seviye atlamayı buradan hissettim. Vay be!",
    ],
    'mascot.celebrate.all_quests_done': [
      "Dur… HEPSİNİ mi bitirdin?!",
      "{{displayName}}! Her görev tamam. Etkilendim.",
      "Tamamdır. Tek tek her görev. Gösterişçi.",
    ],

    'mascot.time.morning': [
      "Günaydın {{displayName}}. Kahve benden — bir şekilde.",
      "Selam {{displayName}} — bugün yumuşak başla.",
      "Günaydın {{displayName}}. Bakalım neler var.",
    ],
    'mascot.time.evening': [
      "Geç saatler, {{displayName}}? Bir minicik şey yeter.",
      "İyi akşamlar {{displayName}}. Yavaşlama zamanı.",
      "Selam {{displayName}} — yatmadan önce sakin bir mola.",
    ],
  } as const;

  return Object.freeze({
    en: Object.freeze(en),
    tr: Object.freeze(tr),
  }) as MascotMessageCatalog;
};

export const MASCOT_MESSAGES: MascotMessageCatalog = buildCatalog();

/* -------------------------------------------------------------------------- */
/* Variant selection + interpolation                                          */
/* -------------------------------------------------------------------------- */

/**
 * Pick a stable index from a context-derived integer. The same context
 * must produce the same line so parents/children don't see flicker.
 */
function stableIndex(seed: number, length: number): number {
  if (!Number.isFinite(seed) || length <= 0) return 0;
  // Non-negative integer modulo. Negative seeds clamp to 0.
  const safe = seed < 0 ? 0 : Math.floor(seed);
  return safe % length;
}

/**
 * Resolve the locale code from a free-form input. Defaults to `en`.
 * Unknown / missing locales fall back to English.
 */
export function resolveMascotLocale(raw: string | undefined | null): MascotLocale {
  if (typeof raw !== 'string') return 'en';
  const lower = raw.toLowerCase().split(/[-_]/)[0];
  if (lower === 'tr') return 'tr';
  return 'en';
}

/**
 * Look up the variants for a key in the requested locale, falling back
 * to English when missing. Returns `null` when the key is unknown so
 * the renderer can show a safe default line.
 */
export function getMascotMessageVariants(
  messageKey: string,
  locale: MascotLocale,
): readonly string[] | null {
  if (typeof messageKey !== 'string' || messageKey.length === 0) return null;
  const localised = MASCOT_MESSAGES[locale]?.[messageKey];
  if (localised && localised.length > 0) return localised;
  const fallback = MASCOT_MESSAGES.en?.[messageKey];
  if (fallback && fallback.length > 0) return fallback;
  return null;
}

/**
 * Format a single variant with safe interpolation. Unknown variables
 * are left in the output verbatim — never silently dropped, never
 * passed through `dangerouslySetInnerHTML`.
 */
export function formatMascotMessage(
  template: string,
  variables: MascotMessageVariables,
): string {
  if (typeof template !== 'string') return '';
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    if (name === 'displayName') {
      const value = variables.displayName;
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
      return 'friend';
    }
    if (name === 'streak') {
      const value = variables.streak;
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(Math.max(0, Math.floor(value)));
      }
      return '0';
    }
    if (name === 'questsRemaining') {
      const value = variables.questsRemaining;
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(Math.max(0, Math.floor(value)));
      }
        return '0';
    }
    // Unknown variable: leave the placeholder verbatim for visibility.
    return `{{${name}}}`;
  });
}

/**
 * The high-level entry point. Returns a single safe line.
 *
 * @param messageKey The key from `MascotPresentation.messageKey`.
 * @param locale IETF code, e.g. `en`, `tr`, `en-GB`. Anything other than
 *               `en` / `tr` falls back to English.
 * @param variables Variables for interpolation. All optional.
 * @param seedStable Optional deterministic seed (e.g. day index) used to
 *                   pick a stable variant. Defaults to `0`.
 */
export function selectMascotMessage(
  messageKey: string,
  locale: string | undefined | null,
  variables: MascotMessageVariables = {},
  seedStable: number = 0,
): string {
  const effectiveLocale = resolveMascotLocale(locale);
  const variants = getMascotMessageVariants(messageKey, effectiveLocale);
  if (!variants || variants.length === 0) {
    // Safe default. NEVER throws.
    const fallback = MASCOT_MESSAGES.en['mascot.default.friendly'];
    return formatMascotMessage(fallback[0], variables);
  }
  const idx = stableIndex(seedStable, variants.length);
  return formatMascotMessage(variants[idx], variables);
}

/**
 * Build the full list of variants for a message key, already interpolated.
 * Useful when the UI wants to render one today, one tomorrow, etc.
 */
export function listMascotMessages(
  messageKey: string,
  locale: string | undefined | null,
  variables: MascotMessageVariables = {},
): readonly string[] {
  const effectiveLocale = resolveMascotLocale(locale);
  const variants = getMascotMessageVariants(messageKey, effectiveLocale);
  if (!variants || variants.length === 0) {
    const fallback = MASCOT_MESSAGES.en['mascot.default.friendly'];
    return Object.freeze(fallback.map((v) => formatMascotMessage(v, variables))) as readonly string[];
  }
  return Object.freeze(variants.map((v) => formatMascotMessage(v, variables))) as readonly string[];
}

/**
 * Editorial helper. Returns the mood+key metadata for a message key.
 * Used by tests and dev tools to audit tone — never displayed raw.
 */
export function describeMascotMessageKey(messageKey: string): {
  key: string;
  mood: MascotMood | null;
  enVariantCount: number;
  trVariantCount: number;
} {
  const enVariants = MASCOT_MESSAGES.en?.[messageKey];
  const trVariants = MASCOT_MESSAGES.tr?.[messageKey];
  const moodFromKey = (): MascotMood | null => {
    if (messageKey.startsWith('mascot.celebrate')) return 'celebrating';
    if (messageKey.startsWith('mascot.welcome_back')) return 'welcome_back';
    if (messageKey.startsWith('mascot.inactivity.long')) return 'grumpy';
    if (messageKey.startsWith('mascot.inactivity.short')) return 'suspicious';
    if (messageKey.startsWith('mascot.streak')) return 'excited';
    if (messageKey.startsWith('mascot.first_meeting')) return 'curious';
    if (messageKey.startsWith('mascot.time')) return 'sleepy';
    if (messageKey.startsWith('mascot.default')) return 'friendly';
    return null;
  };
  return {
    key: messageKey,
    mood: moodFromKey(),
    enVariantCount: enVariants?.length ?? 0,
    trVariantCount: trVariants?.length ?? 0,
  };
}