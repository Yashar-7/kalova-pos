/**
 * KaloVa Dark Warfare — referencia; tokens en src/index.css (@theme).
 */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'action-neon': '#FF003C',
        'cyber-black': '#1A1A1C',
        'cyber-surface': '#121214',
        'cyber-border': '#2E2E32',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
}
