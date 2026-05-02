import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#08070a',
          900: '#0d0c10',
          850: '#121116',
          800: '#17161c',
          700: '#1f1d25',
          600: '#2a2832',
          500: '#3a3744',
        },
        bone: {
          50: '#f5f1ea',
          100: '#e8e3d9',
          200: '#c9c2b4',
          300: '#9a9486',
          400: '#6b665b',
        },
        ember: {
          50: '#fdf2ec',
          100: '#fbdac6',
          200: '#f4a37a',
          300: '#e87144',
          400: '#d94a1f',
          500: '#b83812',
          600: '#8e2a0c',
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
