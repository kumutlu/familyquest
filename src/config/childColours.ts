export const CHILD_COLOUR_SWATCHES = [
  { name: 'Sky', value: '#38bdf8' },
  { name: 'Violet', value: '#a78bfa' },
  { name: 'Rose', value: '#fb7185' },
  { name: 'Amber', value: '#fbbf24' },
  { name: 'Emerald', value: '#34d399' },
  { name: 'Fuchsia', value: '#e879f9' },
] as const;

export type ChildColour = (typeof CHILD_COLOUR_SWATCHES)[number]['value'];
