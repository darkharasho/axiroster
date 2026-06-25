/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // AxiRoster palette — flat neutral-dark (Linear-style) with an indigo accent.
        ink: {
          DEFAULT: '#e9eaec',
          dim: '#9aa0a8',
          faint: '#646a73'
        },
        panel: {
          DEFAULT: '#0b0c0e', // app background
          raised: '#1a1c20', // cards / surfaces
          hover: '#15171a', // row/control hover
          line: '#222428', // hairline borders
          line2: '#2c2f35' // stronger borders / inputs
        },
        accent: {
          DEFAULT: '#6366f1',
          soft: '#818cf8',
          deep: '#4f46e5'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
}
