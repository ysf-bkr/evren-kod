/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    // Tipografi jetonları src/index.css içinde (--evren-kod-text-*) tanımlanır.
    // Tailwind bu değişkenleri adlara eşler, böylece CSS tek doğruluk kaynağı kalır.
    fontFamily: {
      sans: 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)',
      mono: 'var(--vscode-user-editor-font-family, var(--vscode-editor-font-family, "SF Mono", Monaco, Menlo, Consolas, monospace))'
    },
    fontSize: {
      '2xs': ['var(--evren-kod-text-2xs)', { lineHeight: '1.25' }],
      xs: ['var(--evren-kod-text-xs)', { lineHeight: '1.35' }],
      sm: ['var(--evren-kod-text-sm)', { lineHeight: '1.45' }],
      base: ['var(--evren-kod-text-md)', { lineHeight: '1.5' }],
      md: ['var(--evren-kod-text-md)', { lineHeight: '1.5' }],
      lg: ['var(--evren-kod-text-lg)', { lineHeight: '1.55' }],
      xl: ['1.25rem', { lineHeight: '1.6' }]
    }
  },
  plugins: []
};
