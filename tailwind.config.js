/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        sans: ['Figtree', 'sans-serif'],
      },
      colors: {
        ink: {
          950: '#0b1210',
          900: '#121c19',
          800: '#1a2924',
          700: '#2a3d36',
        },
        copper: {
          400: '#e0a06a',
          500: '#c4783a',
          600: '#a35f2a',
        },
        mist: {
          50: '#f4f6f5',
          100: '#e8ecea',
          200: '#d4dcd8',
        },
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'panel-in': {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.7s ease-out both',
        'fade-in': 'fade-in 0.8s ease-out both',
        'panel-in': 'panel-in 0.65s ease-out both',
      },
    },
  },
  plugins: [],
}
