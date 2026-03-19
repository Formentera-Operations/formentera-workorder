import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { AuthProvider } from '@/components/AuthProvider'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

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
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Work Orders" />
        <link rel="apple-touch-icon" href="/icon-512.png" />
      </head>
      <body className={`${inter.variable} font-sans bg-gray-50 text-gray-900 antialiased`}>
        <AuthProvider>
          <div className="mx-auto max-w-lg min-h-screen relative bg-white shadow-sm">
            {children}
          </div>
        </AuthProvider>
      </body>
    </html>
  )
}
