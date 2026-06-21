// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ── Brand colors from spec ──────────────────────────────
      colors: {
        brand: {
          bg:              '#F6F8F6',
          surface:         '#FFFFFF',
          'surface-2':     '#F1F4F1',
          border:          '#E6EBE7',
          ink:             '#0D241C',
          accent:          '#0D241C', // = ink
          primary:         '#10553F',
          'primary-hover': '#0C4232',
          header:          '#FFFFFF',
          muted:           '#5C6E65',
          subtle:          '#8A9991',
          live:            '#16A06A', // emerald accent (focus, progress, active)
          success:         '#0B6B43',
          warning:         '#9A6510',
          danger:          '#B23B2E',
          hold:            '#9A6510',
          pending:         '#8A9991',
          'glass-ink':     '#0D241C',
          'glass-muted':   '#5C6E65',
          'glass-line':    '#E6EBE7',
          green:           '#0B6B43',
          amber:           '#9A6510',
          red:             '#B23B2E',
        },
        green: {
          50:  '#F0F6F3', 100: '#DCEDE5', 200: '#B9DBCB', 300: '#8AC2A9',
          400: '#4FA582', 500: '#2C8763', 600: '#1A6B4B', 700: '#10553F',
          800: '#0C4232', 900: '#082F24', 950: '#05201A',
        },
      },

      // ── Typography ──────────────────────────────────────────
      fontFamily: {
        sans:  ['DM Sans', 'system-ui', 'sans-serif'],
        mono:  ['DM Mono', 'ui-monospace', 'monospace'],
      },

      // ── Animations ──────────────────────────────────────────
      animation: {
        'pulse-dot': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },

      // ── Shadows ─────────────────────────────────────────────
      boxShadow: {
        card:        '0 1px 3px rgba(13,36,28,.06), 0 10px 30px -12px rgba(13,36,28,.14)',
        'card-hover':'0 2px 6px rgba(13,36,28,.08), 0 18px 40px -14px rgba(13,36,28,.18)',
        lift:        '0 20px 50px -16px rgba(13,36,28,.22)',
      },
    },
  },
  plugins: [],
};

export default config;
