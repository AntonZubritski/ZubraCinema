import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ink-* — deep dark with a faint warm-green undertone. Anchors
        // the page in a "cinema after midnight in a forest" feel rather
        // than the previous neutral cool-grey. Subtle enough that
        // posters still read accurately, warm enough that the green
        // accent doesn't fight the background.
        ink: {
          950: '#0a0d0a',
          900: '#0e1210',
          850: '#131816',
          800: '#181f1c',
          700: '#212a25',
          600: '#2c3830',
          500: '#3d4d42',
        },
        // bone-* — slightly warm-toned greyscale (a hint of toasted
        // brown) so labels feel earthy alongside the green. The cast is
        // gentle — text still reads neutral on dark backgrounds.
        bone: {
          50: '#f6f4ee',
          100: '#e7e3d8',
          200: '#c5c0b0',
          300: '#8f8a7a',
          400: '#5e5b50',
        },
        // ember-* — herbal green. We keep the `ember` token name for
        // code stability (every component already references it), but
        // the values now read as fresh moss / grass. ember-400 is the
        // canonical accent — saturated enough to stand off the dark
        // background, muted enough not to feel toy-like.
        ember: {
          50: '#f1f7ed',
          100: '#dceace',
          200: '#a8c890',
          300: '#7daf5d',
          400: '#5a953b',
          500: '#447828',
          600: '#345a1f',
        },
        // clay-* — small warm earthen accent for the rare highlight
        // (CTA hover, decorative underlines). Used sparingly so the
        // page stays predominantly green; this is the "коричневый чуть"
        // the brief asks for, not a second dominant tone.
        clay: {
          400: '#a37246',
          500: '#84582f',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"DM Serif Display"', 'Georgia', 'serif'],
      },
      letterSpacing: {
        tightest: '-0.04em',
      },
      animation: {
        'fade-in': 'fadeIn 220ms ease-out',
        'rise-in': 'riseIn 320ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        'shimmer': 'shimmer 1.6s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        riseIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
