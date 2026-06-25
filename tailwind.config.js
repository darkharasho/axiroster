/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // AxiRoster palette — slate base with an amber/GW2-orange accent.
        ink: {
          DEFAULT: '#e7e5e4',
          dim: '#a8a29e',
          faint: '#78716c'
        },
        panel: {
          DEFAULT: '#1c1917',
          raised: '#292524',
          line: '#3a3531'
        },
        accent: {
          DEFAULT: '#f59e0b',
          soft: '#fbbf24',
          deep: '#b45309'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
}
