import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Build metadata is resolved once, at config load time, and injected as
// compile-time constants. Git may be unavailable (e.g. CI tarball builds), so
// resolution must never throw and fail the build.
function resolveBuildSha(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return sha || 'unknown'
  } catch {
    return 'unknown'
  }
}

const buildSha = resolveBuildSha()
const builtAt = new Date().toISOString()
const appVersion: string = JSON.parse(readFileSync('package.json', 'utf8')).version ?? 'unknown'

// Deterministic production config: when building, force the production mode so
// Vite explicitly loads the committed `.env.production` and embeds the Firebase
// Web SDK values in the bundle (never dependent on a local `.env` existing).
const isBuild = process.argv.includes('build')
const envPrefix = 'VITE_'

export default defineConfig(({ mode }) => {
  // For builds, force-load `.env.production` regardless of the passed mode.
  const resolvedMode = isBuild ? 'production' : mode
  const env = loadEnv(resolvedMode, process.cwd(), envPrefix)

  // Explicitly define every VITE_ var so the production bundle always contains
  // the Firebase config, independent of any local `.env` on the build machine.
  const envDefines = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      `import.meta.env.${key}`,
      JSON.stringify(value),
    ])
  )

  return {
  define: {
    __FAMILYQUEST_BUILD_SHA__: JSON.stringify(buildSha),
    __FAMILYQUEST_BUILT_AT__: JSON.stringify(builtAt),
    __FAMILYQUEST_APP_VERSION__: JSON.stringify(appVersion),
    ...envDefines,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // Firestore rules suites share one emulator process. Serial files prevent
    // parallel project initialization from exhausting the emulator and
    // turning valid assertions into hook/test timeouts.
    fileParallelism: false,
    // The `functions/` directory is a separate deployable package with its own
    // test runner; exclude it (and its nested node_modules) from the web app's
    // test run. Root-level `tests/functions/**` is still included.
    exclude: ['node_modules', 'dist', 'tests/e2e/**', 'functions/**', 'tests/firestore/bootstrapQueries.rules.test.ts', 'tests/firestore/goalReturn.integration.test.ts'],
  },
  plugins: [
    tailwindcss(), 
    react(),
    VitePWA({
      selfDestroying: true,
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.ico',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'apple-touch-icon.png',
        'mask-icon.svg',
      ],
      manifest: {
        name: 'Queki',
        short_name: 'Queki',
        description: 'Gamify your family chores and routines',
        theme_color: '#0f766e',
        background_color: '#0f766e',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ],
  }
})
