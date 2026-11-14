// next.config.mjs
/** @type {import('next').NextConfig} */
const config = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        // Only our own project's public storage (the branding logo), not
        // any *.supabase.co — that let anyone use our image endpoint for
        // images from their own Supabase project.
        hostname: 'wksvwzanacbqictxdrpw.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  reactStrictMode: true,

};

export default config;
