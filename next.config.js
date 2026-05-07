const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  // Service workers are noisy and confusing in dev — only register in prod.
  disable: process.env.NODE_ENV === 'development',
  register: true,
  cacheOnFrontEndNav: true,
  aheadOfTimeCaching: true,
  // Custom snippet appended to the generated SW (handles SKIP_WAITING so
  // the client-side update prompt can activate a waiting worker).
  customWorkerSrc: 'worker',
  fallbacks: {
    document: '/offline',
  },
  workboxOptions: {
    // Don't auto-activate a new SW. Foremen could be mid-form when a deploy
    // lands; we surface an "Update ready" prompt instead so they choose
    // when to reload.
    skipWaiting: false,
    // Network-first for everything: when online, always fetch fresh; when
    // offline, fall back to whatever was last cached. Keeps the app from
    // serving stale data unnecessarily.
    runtimeCaching: [
      {
        // Don't cache mutating API requests at the SW layer — those go
        // through the in-app outbox queue instead.
        urlPattern: ({ request }) => request.method !== 'GET',
        handler: 'NetworkOnly',
      },
      {
        // App pages and Next data — needed so navigating offline still
        // resolves a previously visited route.
        urlPattern: ({ request, url }) =>
          request.destination === 'document' || url.pathname.startsWith('/_next/data/'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages',
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
        },
      },
      {
        // Static JS / CSS / fonts — long-lived, content-hashed by Next.
        urlPattern: ({ url }) => url.pathname.startsWith('/_next/static/'),
        handler: 'CacheFirst',
        options: {
          cacheName: 'static-assets',
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
        },
      },
      {
        // Same-origin GET API calls — cache so the offline shell has
        // something to render. The in-app cachedFetch also caches into IDB
        // independently for finer per-key control.
        urlPattern: ({ request, url, sameOrigin }) =>
          sameOrigin && request.method === 'GET' && url.pathname.startsWith('/api/'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api',
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
        },
      },
      {
        // Images (Next /_next/image and storage URLs).
        urlPattern: ({ request }) => request.destination === 'image',
        handler: 'CacheFirst',
        options: {
          cacheName: 'images',
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
        },
      },
    ],
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  experimental: {
    // Required for snowflake-sdk in API routes
    serverComponentsExternalPackages: ['snowflake-sdk'],
  },
}

module.exports = withPWA(nextConfig)
