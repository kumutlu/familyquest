import { cn } from '../../lib/utils';

/**
 * QuekiMascot — the Queki v2 character presentation layer.
 *
 * IMPORTANT: the Queki is an ORIGINAL creature — a small round "pebble-sprout"
 * being (soft body, single curled sprout on top, large friendly eyes). It is
 * deliberately NOT a cat, owl, fox, bear or any other recognisable animal.
 *
 * ASSET REPLACEMENT CONTRACT: Wave 1 ships a production-quality *placeholder*
 * rendered as inline SVG. Final mascot art replaces `renderPlaceholderArt`
 * below (or is supplied via the `src` image prop) — no page or feature code
 * needs to change, because every surface consumes this component.
 */

export type QuekiMascotState = 'neutral' | 'happy' | 'encouraging' | 'celebration' | 'attention';

export interface QuekiMascotProps {
  state?: QuekiMascotState;
  /** Pixel size of the square art box. */
  size?: number;
  className?: string;
  /**
   * Optional URL of final art. When provided, the image replaces the built-in
   * placeholder entirely (the state then only drives the aria description).
   */
  src?: string;
}

/** Per-state eye/mouth geometry for the placeholder art. */
const STATE_ART: Record<
  QuekiMascotState,
  { eyes: 'open' | 'happy' | 'wide' | 'wink'; mouth: 'smile' | 'grin' | 'o'; extras?: 'sparkle' | 'alert' }
> = {
  neutral: { eyes: 'open', mouth: 'smile' },
  happy: { eyes: 'happy', mouth: 'smile' },
  encouraging: { eyes: 'wink', mouth: 'smile' },
  celebration: { eyes: 'happy', mouth: 'grin', extras: 'sparkle' },
  attention: { eyes: 'wide', mouth: 'o', extras: 'alert' },
};

const STATE_DESCRIPTION: Record<QuekiMascotState, string> = {
  neutral: 'Queki, your family guide',
  happy: 'Queki looking happy',
  encouraging: 'Queki cheering you on',
  celebration: 'Queki celebrating',
  attention: 'Queki has something to show you',
};

function Eyes({ kind }: { kind: 'open' | 'happy' | 'wide' | 'wink' }) {
  if (kind === 'happy') {
    // ∪∪ closed happy eyes
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

function Mouth({ kind }: { kind: 'smile' | 'grin' | 'o' }) {
  if (kind === 'grin') {
    return <path d="M44 66 q10 10 20 0 q-10 4 -20 0 Z" fill="#2b2440" />;
  }
  if (kind === 'o') {
    return <ellipse cx="54" cy="68" rx="5" ry="6" fill="#2b2440" />;
  }
  return <path d="M46 65 q8 7 16 0" stroke="#2b2440" strokeWidth="4" strokeLinecap="round" fill="none" />;
}

/** Temporary neutral Queki asset. Isolated here so final art swaps cleanly. */
function PlaceholderArt({ state }: { state: QuekiMascotState }) {
  const art = STATE_ART[state];
  return (
    <svg viewBox="0 0 108 108" width="100%" height="100%" aria-hidden="true">
      {/* soft ground shadow */}
      <ellipse cx="54" cy="96" rx="26" ry="5" fill="rgba(79,70,229,0.15)" />
      {/* body: rounded pebble */}
      <path
        d="M54 18 C82 18 94 40 94 60 C94 84 76 94 54 94 C32 94 14 84 14 60 C14 40 26 18 54 18 Z"
        fill="url(#qk-body)"
      />
      {/* belly light */}
      <ellipse cx="54" cy="72" rx="24" ry="16" fill="rgba(255,255,255,0.35)" />
      {/* curled sprout */}
      <path d="M54 18 C54 10 58 6 64 4 M54 18 C50 12 44 10 40 11" stroke="#34a06b" strokeWidth="4" strokeLinecap="round" fill="none" />
      <circle cx="65" cy="4" r="4.5" fill="#4ec98c" />
      <circle cx="39" cy="11" r="3.5" fill="#4ec98c" />
      {/* cheeks */}
      <ellipse cx="28" cy="63" rx="6" ry="4" fill="rgba(255,122,107,0.45)" />
      <ellipse cx="80" cy="63" rx="6" ry="4" fill="rgba(255,122,107,0.45)" />
      <Eyes kind={art.eyes} />
      <Mouth kind={art.mouth} />
      {art.extras === 'sparkle' && (
        <g fill="#fbbf24">
          <path d="M92 30 l2.4 5 5 2.4 -5 2.4 -2.4 5 -2.4 -5 -5 -2.4 5 -2.4 Z" />
          <path d="M16 26 l1.8 3.8 3.8 1.8 -3.8 1.8 -1.8 3.8 -1.8 -3.8 -3.8 -1.8 3.8 -1.8 Z" opacity="0.85" />
        </g>
      )}
      {art.extras === 'alert' && (
        <g>
          <circle cx="90" cy="22" r="11" fill="#f95d4e" />
          <text x="90" y="27" textAnchor="middle" fontSize="14" fontWeight="800" fill="#fff">!</text>
        </g>
      )}
      <defs>
        <linearGradient id="qk-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a5b4fc" />
          <stop offset="55%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#6d5ae8" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function QuekiMascot({ state = 'neutral', size = 96, className, src }: QuekiMascotProps) {
  return (
    <span
      role="img"
      aria-label={STATE_DESCRIPTION[state]}
      data-mascot-state={state}
      className={cn('inline-block select-none', className)}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt="" width={size} height={size} className="h-full w-full object-contain" loading="lazy" decoding="async" />
      ) : (
        <PlaceholderArt state={state} />
      )}
    </span>
  );
}
