import type { HelpBlock, HelpSection, HelpSectionId } from '../../types';

/** Türkçe bölüm başlıkları. İngilizce klasörüyle birebir aynı yapıyı izler. */
export const HEADINGS: Record<HelpSectionId, string> = {
  what: 'Nedir',
  why: 'Neden var',
  who: 'Kimler kullanabilir',
  how: 'Nasıl çalışır',
  steps: 'Adım adım',
  tips: 'İpuçları',
  mistakes: 'Sık yapılan hatalar',
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
