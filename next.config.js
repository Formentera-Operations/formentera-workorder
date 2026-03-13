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

module.exports = nextConfig
