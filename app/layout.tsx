import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { AuthProvider } from '@/components/AuthProvider'
import { Toaster } from 'sonner'
import './globals.css'

// Inter is self-hosted rather than pulled via next/font/google. The Google
// loader downloads the font on the server at compile time, which fails with
// EACCES anywhere the dev server has no outbound network and burns three
// retries before silently falling back to a system font. Same font, same
// latin subset, same --font-inter variable — just no build-time fetch.
const inter = localFont({
  src: './fonts/Inter-latin-variable.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-inter',
})

// Next.js App Router auto-injects <meta charSet="utf-8" /> as the first
// child of <head> from the metadata API, plus the apple-touch-icon and
// the apple-mobile-web-app-* tags from `appleWebApp`. Don't add a manual
// <head> block — it caused duplicate charset/viewport tags and Lighthouse
// flagged the duplication as a Best Practices failure.
export const metadata: Metadata = {
  title: 'Work Orders',
  description: 'Formentera Work Order Management',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Work Orders',
  },
  icons: {
    apple: '/icon-512.png',
  },
  other: {
    // Android Chrome's "Add to Home Screen" standalone hint. Separate
    // from apple-mobile-web-app-capable (which appleWebApp above covers).
    'mobile-web-app-capable': 'yes',
  },
}

// Mobile viewport. Pinch-zoom is intentionally allowed (was disabled in
// an earlier iteration but that failed Lighthouse a11y for low-vision
// users). iOS Safari won't auto-zoom on input focus because every input/
// select/textarea is forced to 16px on mobile in globals.css.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans bg-gray-50 text-gray-900 antialiased`}>
        <AuthProvider>
          {children}
        </AuthProvider>
        <Toaster position="top-center" richColors />
      </body>
    </html>
  )
}
