/*
 * ONE-RELEASE service-worker migration for legacy clients such as 82422c8.
 * Remove this file and restore the normal waiting lifecycle after the rescue
 * release. This script is imported only by the migration worker build.
 */
const MIGRATION_ID = 'legacy-82422c8-2026-08'
const MIGRATION_CACHE = `queki-sw-migration-${MIGRATION_ID}`
const MIGRATION_MARKER = new Request('/__queki_sw_migration_complete__')

// When this worker is evaluated as an update, registration.active is the
// legacy worker that currently owns existing windows. It is null on a genuine
// first install, so fresh installations are never migration-navigated.
const HAS_LEGACY_ACTIVE_WORKER = Boolean(self.registration.active)

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    if (!HAS_LEGACY_ACTIVE_WORKER) return

    const cache = await caches.open(MIGRATION_CACHE)
    if (await cache.match(MIGRATION_MARKER)) return

    // Snapshot only the windows that existed before this migration worker
    // claimed the origin. Tabs opened after activation are not in this list.
    const legacyClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })

    await self.clients.claim()
    await cache.put(MIGRATION_MARKER, new Response(MIGRATION_ID))

    for (const client of legacyClients) {
      client.postMessage({
        type: 'LEGACY_SW_MIGRATION_NAVIGATING',
        migrationId: MIGRATION_ID,
      })
      // Do not await this promise from activate.waitUntil(): the navigation is
      // served only after activation completes, so awaiting it deadlocks the
      // worker in "activating". Invocation is still activation-only.
      void client.navigate(client.url)
    }
  })())
})
