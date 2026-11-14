// next.config.mjs

const SUPABASE = 'wksvwzanacbqictxdrpw.supabase.co';
const TURNSTILE = 'https://challenges.cloudflare.com';
const dev = process.env.NODE_ENV !== 'production';

// Content-Security-Policy. Scripts and styles still allow 'unsafe-inline'
// (Next 14 injects inline hydration scripts; a nonce needs middleware), so
// the main wins here are: no third-party scripts, data only goes to our own
// Supabase project, and nobody can frame the app (clickjacking).
// Adding an outside service (analytics, a new widget)? Allow its origin here.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${TURNSTILE}${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://${SUPABASE}`,
  "font-src 'self' data:",
  `connect-src 'self' https://${SUPABASE} wss://${SUPABASE} ${TURNSTILE}${dev ? ' ws:' : ''}`,
  `frame-src ${TURNSTILE}`,
  // blob: — Realtime runs its heartbeat in a blob Worker (realtime.worker in
  // src/lib/supabase/client.ts) so background tabs keep their socket alive.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const config = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        // Only our own project's public storage (the branding logo), not
        // any *.supabase.co — that let anyone use our image endpoint for
        // images from their own Supabase project.
        hostname: SUPABASE,
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  reactStrictMode: true,

};

export default config;
