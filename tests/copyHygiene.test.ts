import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

describe('Copy Hygiene & Generic Placeholders', () => {
  const rootDir = resolve(__dirname, '..');
  const srcDir = join(rootDir, 'src');

  it('en/onboarding.json s6.placeholder must be "e.g. The Smiths" and contain no developer names', () => {
    const enOnboarding = JSON.parse(
      readFileSync(join(srcDir, 'i18n/locales/en/onboarding.json'), 'utf-8')
    );
    expect(enOnboarding.s6.placeholder).toBe('e.g. The Smiths');
    expect(enOnboarding.s6.placeholder).not.toMatch(/umutlu|ali|kemal/i);
  });

  it('tr/onboarding.json s6.placeholder must not contain developer names', () => {
    const trOnboarding = JSON.parse(
      readFileSync(join(srcDir, 'i18n/locales/tr/onboarding.json'), 'utf-8')
    );
    expect(trOnboarding.s6.placeholder).not.toMatch(/umutlu|ali|kemal/i);
    expect(trOnboarding.s6.placeholder).toMatch(/ör\./i);
  });

  it('ChildQrScanPage.tsx has generic placeholder "e.g. Alex"', () => {
    const content = readFileSync(join(srcDir, 'pages/ChildQrScanPage.tsx'), 'utf-8');
    expect(content).toContain('placeholder="e.g. Alex"');
    expect(content).not.toMatch(/placeholder=".*(ali|kemal|umutlu).*"/i);
  });

  it('AddChildModal.tsx has generic placeholder "e.g. Sam"', () => {
    const content = readFileSync(join(srcDir, 'components/family/AddChildModal.tsx'), 'utf-8');
    expect(content).toContain('placeholder="e.g. Sam"');
    expect(content).not.toMatch(/placeholder=".*(ali|kemal|umutlu).*"/i);
  });

  it('no user-facing files in src contain developer family name in placeholders', () => {
    const walk = (dir: string): string[] => {
      let results: string[] = [];
      const list = readdirSync(dir);
      list.forEach((file: string) => {
        const fullPath = join(dir, file);
        const stat = statSync(fullPath);
        if (stat && stat.isDirectory()) {
          if (!file.includes('node_modules') && !file.startsWith('.')) {
            results = results.concat(walk(fullPath));
          }
        } else if (/\.(tsx?|json)$/.test(file) && !file.includes('.test.') && !file.includes('.spec.')) {
          results.push(fullPath);
        }
      });
      return results;
    };

    const files = walk(srcDir);
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const placeholderRegex = /placeholder\s*[:=]\s*["'`]([^"'`]*?(?:umutlu|ali\b|kemal)[^"'`]*?)["'`]/gi;
      let match;
      while ((match = placeholderRegex.exec(content)) !== null) {
        violations.push(`${file}: ${match[0]}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
