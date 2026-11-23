import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI"', 'Inter', 'system-ui', '-apple-system', 'Roboto', 'Arial', 'sans-serif'],
        mono: ['"Cascadia Code"', 'Consolas', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe6fe',
          500: '#3b6ef5',
          600: '#2557e0',
          700: '#1d45b5',
        },
      },
    },
  },
  plugins: [],
};

export default config;
