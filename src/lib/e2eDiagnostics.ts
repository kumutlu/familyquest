export function recordE2ETimeline(event: string, detail: Record<string, unknown> = {}) {
  if (import.meta.env.VITE_USE_FIREBASE_EMULATOR !== 'true') return;
  console.info('[e2e-timeline]', JSON.stringify({ event, at: new Date().toISOString(), ...detail }));
}
