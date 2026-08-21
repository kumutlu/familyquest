import type { ConsoleMessage, Page, TestInfo } from '@playwright/test';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

export const isFirestoreTransportError = (message: string) =>
  /Firestore\/(Write|Listen)\/channel|WebChannelConnection RPC '(Write|Listen)'|Could not reach Cloud Firestore backend[\s\S]*code=unavailable/.test(message);

export function collectE2ETimeline(page: Page) {
  const events: string[] = [];
  const transport: Array<{ stream: 'Write' | 'Listen'; message: string }> = [];
  const listener = (message: ConsoleMessage) => {
    if (message.type() === 'info' && message.text().startsWith('[e2e-timeline]')) events.push(message.text());
    const stream = /Firestore\/(Write|Listen)\/channel|RPC '(Write|Listen)'/.exec(message.text())?.slice(1).find(Boolean);
    if (stream === 'Write' || stream === 'Listen') transport.push({ stream, message: message.text() });
  };
  page.on('console', listener);
  return async (testInfo: TestInfo) => {
    page.off('console', listener);
    await testInfo.attach('signup-profile-setup-timeline', {
      body: `${events.join('\n')}\n`,
      contentType: 'application/x-ndjson',
    });
    if (transport.length && process.env.ONBOARDING_GATE_ARTIFACT_DIR) {
      const path = join(process.env.ONBOARDING_GATE_ARTIFACT_DIR, 'transport-events.ndjson');
      for (const event of transport) appendFileSync(path, `${JSON.stringify({ test: testInfo.title, ...event })}\n`);
    }
    await testInfo.attach('firestore-transport-health', {
      body: JSON.stringify({ writeErrors: transport.filter(item => item.stream === 'Write').length, listenErrors: transport.filter(item => item.stream === 'Listen').length, events: transport }, null, 2),
      contentType: 'application/json',
    });
  };
}
