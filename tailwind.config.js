/** @type {import('tailwindcss').Config} */
import animate from "tailwindcss-animate"

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['JetBrains Mono', 'monospace'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        swiss: {
          red: '#FF0000',
          black: '#050505',
          white: '#F0F0F0',
          gray: '#1A1A1A',
        },
      },
    },
  },
  plugins: [
    animate
  ],
}
