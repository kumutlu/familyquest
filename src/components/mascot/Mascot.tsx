/**
 * <Mascot /> — the single Queki mascot character for the entire product.
 *
 * ARCHITECTURE
 * ------------
 * There is ONE mascot character. Children do not choose between characters.
 * The same character changes mood, expression, animation, message, and
 * seasonal costume. This component is the SOLE rendering surface for that
 * character.
 *
 * The component consumes a {@link MascotAssetDescriptor} (one descriptor
 * per surface). It does NOT branch on mood inline — the engine produces
 * the descriptor, the renderer looks it up.
 *
 * ASSET REPLACEMENT CONTRACT
 * --------------------------
 * V1 ships a production-quality placeholder rendered as inline SVG. Final
 * mascot artwork replaces `renderPlaceholderArt` below, OR is supplied
 * via the `src` image prop. No page or feature code needs to change
 * because every surface consumes this component.
 *
 * SEPARATION
 * ----------
 * This file is presentation only. It does NOT read gamification data,
 * does NOT award XP / points / wallet, does NOT mutate streaks, does
 * NOT complete tasks, does NOT modify Firestore Rules.
 */

import { cn } from '../../lib/utils';
import type { MascotExpression, MascotMood, MascotPresentation } from '../../domain/mascot';

/* -------------------------------------------------------------------------- */
/* Descriptor                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A neutral, renderer-facing description of what the mascot should look
 * like right now. Derived from {@link MascotPresentation} but stable for
 * art-routing purposes.
 */
export interface MascotAssetDescriptor {
  /** Stable character id. For V1 there is only `queki`. */
  characterId: 'queki';
  /** Which mood the character should express. */
  mood: MascotMood;
  /** Which face / expression geometry to render. */
  expression: MascotExpression;
  /** Optional seasonal / event costume reference. Undefined = no costume. */
  costumeId?: string;
  /** Optional animation id. Undefined = use the mood default. */
  animationId?: MascotPresentation['animationId'];
}

export interface MascotProps {
  /**
   * The presentation bundle produced by the Mascot Engine. Optional — when
   * omitted, the component renders a neutral friendly default.
   */
  presentation?: MascotPresentation | null;
  /** Pixel size of the square art box. */
  size?: number;
  className?: string;
  /**
   * Optional URL of final art. When provided, the image replaces the
   * built-in placeholder entirely (the descriptor still drives the
   * aria description).
   */
  src?: string;
  /**
   * Override the descriptor without a full presentation. Useful for
   * surfaces that just need a static pose.
   */
  descriptor?: MascotAssetDescriptor;
}

function toDescriptor(presentation: MascotPresentation | null | undefined): MascotAssetDescriptor {
  if (!presentation) {
    return {
      characterId: 'queki',
      mood: 'friendly',
      expression: 'soft_smile',
    };
  }
  const descriptor: MascotAssetDescriptor = {
    characterId: 'queki',
    mood: presentation.mood,
    expression: presentation.expression,
  };
  if (presentation.costumeId) descriptor.costumeId = presentation.costumeId;
  if (presentation.animationId) descriptor.animationId = presentation.animationId;
  return descriptor;
}

/* -------------------------------------------------------------------------- */
/* Aria description                                                           */
/* -------------------------------------------------------------------------- */

const MOOD_DESCRIPTION: Record<MascotMood, string> = {
  friendly: 'Queki, your friendly guide',
  excited: 'Queki excited',
  proud: 'Queki proud of you',
  sleepy: 'Queki sleepy',
  curious: 'Queki curious',
  suspicious: 'Queki looking around',
  grumpy: 'Queki pretending to be grumpy',
  sad: 'Queki a bit down',
  shocked: 'Queki surprised',
  celebrating: 'Queki celebrating',
  welcome_back: 'Queki waving hello',
};

/* -------------------------------------------------------------------------- */
/* Art routing                                                                */
/* -------------------------------------------------------------------------- */

const EXPRESSION_TO_PLACEHOLDER: Record<MascotExpression, {
  eyes: 'open' | 'happy' | 'wide' | 'wink' | 'sleepy';
  mouth: 'smile' | 'grin' | 'o' | 'frown';
  extras?: 'sparkle' | 'sparkle_burst' | 'wave';
}> = {
  soft_smile: { eyes: 'open', mouth: 'smile' },
  big_smile: { eyes: 'happy', mouth: 'grin' },
  wink: { eyes: 'wink', mouth: 'smile' },
  closed_eyes: { eyes: 'happy', mouth: 'smile' },
  wide_eyes: { eyes: 'wide', mouth: 'o' },
  raised_eyebrow: { eyes: 'open', mouth: 'smile' },
  frown: { eyes: 'open', mouth: 'frown' },
  sleepy_eyes: { eyes: 'sleepy', mouth: 'smile' },
  open_mouth: { eyes: 'wide', mouth: 'o' },
  sparkle: { eyes: 'happy', mouth: 'smile', extras: 'sparkle' },
  sparkle_burst: { eyes: 'happy', mouth: 'grin', extras: 'sparkle_burst' },
};

/** Mapping from costume id → accent overlay token. Final art will replace this. */
const COSTUME_ACCENT: Record<string, string> = {
  'mascot.santa-hat': '#c0392b',
  'mascot.witch-hat': '#6b21a8',
  'mascot.lantern': '#f59e0b',
  'mascot.festive-robe': '#059669',
};

/* -------------------------------------------------------------------------- */
/* Placeholder art (replaceable)                                              */
/* -------------------------------------------------------------------------- */

function PlaceholderEyes({ kind }: { kind: 'open' | 'happy' | 'wide' | 'wink' | 'sleepy' }) {
  if (kind === 'happy') {
    return (
      <g stroke="#2b2440" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M34 52 q6 -8 12 0" />
        <path d="M62 52 q6 -8 12 0" />
      </g>
    );
  }
  if (kind === 'wink') {
    return (
      <g>
        <ellipse cx="40" cy="53" rx="5" ry="7" fill="#2b2440" />
        <circle cx="42" cy="50" r="1.8" fill="#fff" />
        <path d="M62 53 q6 -8 12 0" stroke="#2b2440" strokeWidth="4" strokeLinecap="round" fill="none" />
      </g>
    );
  }
  if (kind === 'sleepy') {
    return (
      <g stroke="#2b2440" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M34 54 q6 6 12 0" />
        <path d="M62 54 q6 6 12 0" />
      </g>
    );
  }
  const ry = kind === 'wide' ? 9 : 7;
  return (
    <g>
      <ellipse cx="40" cy="53" rx="5.5" ry={ry} fill="#2b2440" />
      <circle cx="42" cy="50" r="2" fill="#fff" />
      <ellipse cx="68" cy="53" rx="5.5" ry={ry} fill="#2b2440" />
      <circle cx="70" cy="50" r="2" fill="#fff" />
    </g>
  );
}

function PlaceholderMouth({ kind }: { kind: 'smile' | 'grin' | 'o' | 'frown' }) {
  if (kind === 'grin') {
    return <path d="M44 66 q10 10 20 0 q-10 4 -20 0 Z" fill="#2b2440" />;
  }
  if (kind === 'o') {
    return <ellipse cx="54" cy="68" rx="5" ry="6" fill="#2b2440" />;
  }
  if (kind === 'frown') {
    return <path d="M46 70 q8 -7 16 0" stroke="#2b2440" strokeWidth="4" strokeLinecap="round" fill="none" />;
  }
  return <path d="M46 65 q8 7 16 0" stroke="#2b2440" strokeWidth="4" strokeLinecap="round" fill="none" />;
}

function PlaceholderArt({ descriptor }: { descriptor: MascotAssetDescriptor }) {
  const art = EXPRESSION_TO_PLACEHOLDER[descriptor.expression];
  const costumeAccent = descriptor.costumeId
    ? COSTUME_ACCENT[descriptor.costumeId]
    : undefined;
  const aria = MOOD_DESCRIPTION[descriptor.mood];

  return (
    <svg viewBox="0 0 108 108" width="100%" height="100%" aria-hidden="true">
      <title>{aria}</title>
      {/* Soft ground shadow */}
      <ellipse cx="54" cy="96" rx="26" ry="5" fill="rgba(79,70,229,0.15)" />
      {/* Costume accent — a small festive hat/lantern hint above the head */}
      {costumeAccent && (
        <g>
          <path
            d="M54 18 C54 10 60 4 66 2 L70 0 L72 8 L62 12 Z"
            fill={costumeAccent}
            stroke="rgba(0,0,0,0.15)"
            strokeWidth="0.5"
          />
          <circle cx="70" cy="2" r="3" fill="#fff" opacity="0.85" />
        </g>
      )}
      {/* Body: rounded pebble */}
      <path
        d="M54 18 C82 18 94 40 94 60 C94 84 76 94 54 94 C32 94 14 84 14 60 C14 40 26 18 54 18 Z"
        fill="url(#mascot-body)"
      />
      {/* Belly light */}
      <ellipse cx="54" cy="72" rx="24" ry="16" fill="rgba(255,255,255,0.35)" />
      {/* Curled sprout (when no costume hat) */}
      {!costumeAccent && (
        <g>
          <path d="M54 18 C54 10 58 6 64 4 M54 18 C50 12 44 10 40 11" stroke="#34a06b" strokeWidth="4" strokeLinecap="round" fill="none" />
          <circle cx="65" cy="4" r="4.5" fill="#4ec98c" />
          <circle cx="39" cy="11" r="3.5" fill="#4ec98c" />
        </g>
      )}
      {/* Cheeks */}
      <ellipse cx="28" cy="63" rx="6" ry="4" fill="rgba(255,122,107,0.45)" />
      <ellipse cx="80" cy="63" rx="6" ry="4" fill="rgba(255,122,107,0.45)" />
      {/* Eyes + mouth */}
      <PlaceholderEyes kind={art.eyes} />
      <PlaceholderMouth kind={art.mouth} />
      {/* Sparkles */}
      {art.extras === 'sparkle' && (
        <g fill="#fbbf24">
          <path d="M92 30 l2.4 5 5 2.4 -5 2.4 -2.4 5 -2.4 -5 -5 -2.4 5 -2.4 Z" />
        </g>
      )}
      {art.extras === 'sparkle_burst' && (
        <g fill="#fbbf24">
          <path d="M92 30 l2.4 5 5 2.4 -5 2.4 -2.4 5 -2.4 -5 -5 -2.4 5 -2.4 Z" />
          <path d="M16 26 l1.8 3.8 3.8 1.8 -3.8 1.8 -1.8 3.8 -1.8 -3.8 -3.8 -1.8 3.8 -1.8 Z" opacity="0.85" />
          <path d="M54 100 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6 Z" opacity="0.7" />
        </g>
      )}
      <defs>
        <linearGradient id="mascot-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a5b4fc" />
          <stop offset="55%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#6d5ae8" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Render the Queki mascot.
 *
 * The component NEVER branches on `mood === '...'` inline for *behaviour*
 * (it maps mood to art geometry, which is a renderer concern). It does
 * NOT read or write gamification state.
 */
export function Mascot({
  presentation,
  size = 96,
  className,
  src,
  descriptor,
}: MascotProps) {
  const resolved: MascotAssetDescriptor = descriptor ?? toDescriptor(presentation);
  const description = MOOD_DESCRIPTION[resolved.mood];

  return (
    <span
      role="img"
      aria-label={description}
      data-testid="mascot-character"
      data-mascot-mood={resolved.mood}
      data-mascot-expression={resolved.expression}
      data-mascot-character={resolved.characterId}
      {...(resolved.costumeId ? { 'data-mascot-costume': resolved.costumeId } : {})}
      {...(resolved.animationId ? { 'data-mascot-animation': resolved.animationId } : {})}
      className={cn('inline-block select-none', className)}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-contain"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <PlaceholderArt descriptor={resolved} />
      )}
    </span>
  );
}

export default Mascot;