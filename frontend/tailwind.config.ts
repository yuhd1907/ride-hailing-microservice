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
        // Tone đen trắng tối giản: nút và điểm nhấn màu đen, nền nhấn xám rất nhạt.
        brand: {
          50: '#f3f3f3',
          100: '#e8e8e8',
          500: '#545454',
          600: '#000000',
          700: '#2b2b2b',
          800: '#161616',
        },
      },
    },
  },
  plugins: [],
};

export default config;
