/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          red: '#EE2435',
          'red-dark': '#C81B2B',
          'red-light': '#FDE8EA',
          navy: '#011E41',
          'navy-light': '#E6EAF0',
        },
        red: {
          50: '#FEF2F3',
          100: '#FDE8EA',
          200: '#FAC5CA',
          300: '#F58F98',
          400: '#F15A67',
          500: '#EE2435',
          600: '#EE2435',
          700: '#C81B2B',
          800: '#A11522',
          900: '#7A101A',
          950: '#4D0A10',
        },
      },
    },
  },
}
