/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{ts,tsx}',
    './src/web/index.html',
    './src/web/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        // AxiRoster palette — flat neutral-dark (Linear-style) with an emerald accent.
        ink: {
          DEFAULT: '#e9eaec',
          dim: '#9aa0a8',
          faint: '#646a73'
        },
        panel: {
          sunk: '#141416', // sunken zones — rail, sub-header, inset fields
          DEFAULT: '#1a1a1c', // app background — warm-neutral charcoal
          raised: '#252528', // cards / surfaces
          hover: '#1e1e21', // row/control hover
          line: '#2f2f34', // hairline borders
          line2: '#3a3a40' // stronger borders / inputs
        },
        accent: {
          DEFAULT: '#047857', // emerald 700
          soft: '#10b981', // emerald 500 — hovers / highlights
          deep: '#065f46' // emerald 800 — pressed / hover-darken
        }
      },
      // Layered-elevation primitives: raised surfaces use a subtle top→bottom
      // gradient + a 1px inner light edge + a soft drop shadow so they read as
      // floating above the (darker) base; inputs read as pressed/sunken.
      backgroundImage: {
        raise: 'linear-gradient(#232327, #202023)',
        'raise-lg': 'linear-gradient(#222226, #1f1f23)'
      },
      boxShadow: {
        raise: '0 2px 6px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.045)',
        'raise-lg': '0 4px 12px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.04)',
        sunk: 'inset 0 1px 2px rgba(0,0,0,.45)'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
}
