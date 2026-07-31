import type { HelpBlock, HelpSection, HelpSectionId } from '../../types';

/** Section headings for English. Mirrored by every other language folder. */
export const HEADINGS: Record<HelpSectionId, string> = {
  what: 'What it is',
  why: 'Why it exists',
  who: 'Who can use it',
  how: 'How it works',
  steps: 'Step by step',
  tips: 'Tips',
  mistakes: 'Common mistakes',
};

export function section(id: HelpSectionId, blocks: HelpBlock[]): HelpSection {
  return { id, heading: HEADINGS[id], blocks };
}

export const p = (text: string): HelpBlock => ({ kind: 'paragraph', text });
export const ul = (items: string[]): HelpBlock => ({ kind: 'list', items });
export const ol = (items: string[]): HelpBlock => ({ kind: 'list', items, ordered: true });
export const steps = (
  items: { title: string; detail?: string }[]
): HelpBlock => ({ kind: 'steps', steps: items });
export const tip = (text: string): HelpBlock => ({ kind: 'callout', tone: 'tip', text });
export const info = (text: string): HelpBlock => ({ kind: 'callout', tone: 'info', text });
export const warn = (text: string): HelpBlock => ({ kind: 'callout', tone: 'warning', text });
export const soon = (text: string): HelpBlock => ({ kind: 'callout', tone: 'comingSoon', text });
export const faq = (items: { q: string; a: string }[]): HelpBlock => ({ kind: 'faq', items });
