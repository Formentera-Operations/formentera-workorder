import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { AuthProvider } from '@/components/AuthProvider'
import { Toaster } from 'sonner'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

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

// Strict mobile viewport — no pinch zoom, no scaling. Lives in its own
// export now (was a manual <meta name="viewport"> tag in <head>) so
// Next.js renders it once instead of double-emitting alongside its own.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
