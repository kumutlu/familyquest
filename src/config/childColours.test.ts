import { describe, expect, expectTypeOf, it } from 'vitest';
import { CHILD_COLOUR_SWATCHES, type ChildColour } from './childColours';

describe('CHILD_COLOUR_SWATCHES', () => {
  it('exports the canonical unique swatches as a readonly typed array', () => {
    expect(CHILD_COLOUR_SWATCHES).toEqual([
      { name: 'Sky', value: '#38bdf8' },
      { name: 'Violet', value: '#a78bfa' },
      { name: 'Rose', value: '#fb7185' },
      { name: 'Amber', value: '#fbbf24' },
      { name: 'Emerald', value: '#34d399' },
      { name: 'Fuchsia', value: '#e879f9' },
    ]);
    expect(new Set(CHILD_COLOUR_SWATCHES.map(({ value }) => value)).size).toBe(CHILD_COLOUR_SWATCHES.length);

    expectTypeOf<typeof CHILD_COLOUR_SWATCHES>().toEqualTypeOf<
      readonly [
        { readonly name: 'Sky'; readonly value: '#38bdf8' },
        { readonly name: 'Violet'; readonly value: '#a78bfa' },
        { readonly name: 'Rose'; readonly value: '#fb7185' },
        { readonly name: 'Amber'; readonly value: '#fbbf24' },
        { readonly name: 'Emerald'; readonly value: '#34d399' },
        { readonly name: 'Fuchsia'; readonly value: '#e879f9' },
      ]
    >();
    expectTypeOf<ChildColour>().toEqualTypeOf<
      '#38bdf8' | '#a78bfa' | '#fb7185' | '#fbbf24' | '#34d399' | '#e879f9'
    >();
  });
});
