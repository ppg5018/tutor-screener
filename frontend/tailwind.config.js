/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'dark-bg': '#0a0a0f',
        'vio': '#7c3aed',
        'vio-light': '#a78bfa',
      },
      fontFamily: {
        syne: ['Syne', 'sans-serif'],
        inter: ['Inter', 'sans-serif'],
      },
      keyframes: {
        'pulse-ring': {
          '0%':   { transform: 'scale(1)',    opacity: '0.5' },
          '100%': { transform: 'scale(1.65)', opacity: '0' },
        },
        wave: {
          '0%, 100%': { transform: 'scaleY(0.25)' },
          '50%':      { transform: 'scaleY(1)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-24px)' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(18px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-in': {
          '0%':   { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-right': {
          '0%':   { opacity: '0', transform: 'translateX(12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'score-fill': {
          '0%': { width: '0%' },
        },
        // ── Avatar animations ──────────────────────────────────────
        breathe: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%':      { transform: 'scale(1.012)' },
        },
        blink: {
          '0%, 90%, 100%': { transform: 'scaleY(1)' },
          '95%':           { transform: 'scaleY(0.08)' },
        },
        'mouth-speak': {
          '0%, 100%': { d: 'path("M 44 78 Q 50 81 56 78")' },
          '50%':      { d: 'path("M 44 77 Q 50 84 56 77")' },
        },
        'eye-think': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-2px)' },
        },
        bob: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%':      { transform: 'rotate(0.8deg)' },
          '75%':      { transform: 'rotate(-0.8deg)' },
        },
        'ring-glow': {
          '0%, 100%': { opacity: '0.7', transform: 'scale(1)' },
          '50%':      { opacity: '1',   transform: 'scale(1.03)' },
        },
      },
      animation: {
        'pulse-ring':      'pulse-ring 1.8s ease-out infinite',
        'pulse-ring-slow': 'pulse-ring 1.8s ease-out infinite 0.6s',
        wave:              'wave 1.1s ease-in-out infinite',
        float:             'float 7s ease-in-out infinite',
        'float-slow':      'float 9s ease-in-out infinite 2s',
        'float-slower':    'float 11s ease-in-out infinite 4s',
        'fade-up':         'fade-up 0.55s ease-out both',
        'fade-in':         'fade-in 0.4s ease-out both',
        'slide-in':        'slide-in 0.4s ease-out both',
        'slide-in-right':  'slide-in-right 0.4s ease-out both',
        'score-fill':      'score-fill 1.2s ease-out both',
        // avatar
        breathe:           'breathe 3.5s ease-in-out infinite',
        blink:             'blink 4s ease-in-out infinite',
        'blink-fast':      'blink 2.8s ease-in-out infinite 1.4s',
        'eye-think':       'eye-think 1.8s ease-in-out infinite',
        bob:               'bob 0.55s ease-in-out infinite',
        'ring-glow':       'ring-glow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
