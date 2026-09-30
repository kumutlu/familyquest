/**
 * `<SeasonalLine />` — the short, deterministic seasonal line that
 * announces the current world in copy.
 *
 * Architectural rules
 * -------------------
 *   - It is NOT a heading. It is a small line.
 *   - It is NOT a button. It does not navigate.
 *   - It is NOT an Adventure. It carries no urgency, no XP pop, no
 *     quest data, no completion path.
 *   - It is decorative copy. A screen reader may announce it but the
 *     world renderer keeps the rest of the world aria-hidden.
 *   - Reduced motion does NOT hide the line — the line has no motion
 *     and remains visible so the world reads as decorated.
 *
 * The line is sourced from the resolved world definition. The shell
 * decides when to render it; this component is the visual surface.
 */

import type { WorldId } from '../../domain/experienceWorld/types';

export interface SeasonalLineProps {
  /** Current world id. Used for QA labels and the data attribute. */
  readonly worldId: WorldId;
  /** The deterministic line. */
  readonly line: string;
  /** Optional wrapper class. */
  readonly className?: string;
}

export function SeasonalLine({ worldId, line, className }: SeasonalLineProps) {
  return (
    <p
      data-testid="world-seasonal-line"
      data-world-id={worldId}
      role="note"
      className={`qk-world-seasonal-line ${className ?? ''}`.trim()}
    >
      <span aria-hidden="true" className="qk-world-seasonal-line__dot" />
      <span>{line}</span>
    </p>
  );
}

export default SeasonalLine;
