/** BreedIQ Tailwind config — builds a static stylesheet (styles.css) from the
 *  classes actually used across all pages, replacing the in-browser JIT.
 *  Every class in the codebase appears as a complete string literal (verified:
 *  no computed `bg-${x}` fragments), so the content scanner captures them all.
 *  No safelist needed. */
module.exports = {
  content: ['./*.html', './src/**/*.jsx'],
  theme: { extend: {} },
  plugins: [],
}
