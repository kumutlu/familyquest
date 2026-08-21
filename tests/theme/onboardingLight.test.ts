import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const shell = readFileSync(
  resolve(process.cwd(), 'src/onboarding/components/OnboardingShell.tsx'),
  'utf8',
);

describe('onboarding theme contract', () => {
  it('does not retain the legacy forced-light token scope', () => {
    expect(css).not.toMatch(/\.light\s*\{/);
    expect(shell).not.toContain('className="light');
  });

  it('keeps the global dark theme and gives the onboarding shell explicit dark surfaces', () => {
    expect(css).toMatch(/\.dark\s*\{[^}]*--color-gray-50\s*:\s*#0e1116/);
    expect(shell).toContain('dark:bg-slate-950');
    expect(shell).toContain('dark:text-slate-100');
  });

  it('defines motion that is opt-out safe at each animated scene', () => {
    const scenes = readFileSync(
      resolve(process.cwd(), 'src/onboarding/visuals/OnboardingScenes.tsx'),
      'utf8',
    );
    expect(scenes).toContain('motion-reduce:animate-none');
    expect(scenes).toContain('motion-safe:animate-');
    expect(css).toContain('@keyframes onboarding-child-join');
  });
});
