/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          950: '#0b0f19', // deep slate navy
        },
        // Official/Admin Palette: Deep Navy & Gold/Amber Highlights
        admin: {
          bg: '#0b111e',        // very dark professional slate-blue
          card: '#151c2c',      // clean container blue-gray
          border: '#222f47',    // subtle border
          primary: '#1d4ed8',   // solid navy blue (royal blue)
          accent: '#b45309',    // authoritative amber/gold
          text: '#f8fafc',      // bright light text (950 level contrast check)
          muted: '#cbd5e1'      // highly visible slate text for dark background
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
