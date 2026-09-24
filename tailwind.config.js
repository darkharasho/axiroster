/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{ts,tsx}',
    './src/web/index.html',
    './src/web/**/*.{ts,tsx}'
  ],
  // Tailwind is layout only here: colour, outline weight, offset block and
  // radius all come from @axiapps/axi-design's tokens, so the palette that
  // used to live in this file is gone rather than re-pointed. The one theme
  // extension left maps the font utilities onto the language's own stacks so
  // `font-sans`/`font-mono` can't drift from --axi-sans/--axi-mono.
  theme: {
    extend: {
      fontFamily: {
        sans: 'var(--axi-sans)',
        mono: 'var(--axi-mono)'
      }
    }
  },
  plugins: []
}
