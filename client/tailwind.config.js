/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        spotify: {
          green: '#1DB954',
          dark: '#121212',
          card: '#181818',
          hover: '#282828',
          text: '#B3B3B3',
        },
        accent: {
          lime: '#CCFF00',
          pink: '#FF006E',
          violet: '#8338EC',
          cyan: '#00F5D4',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slideUp 0.5s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'bounce-in': 'bounceIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'spin-slow': 'spin 8s linear infinite',
        'eq-1': 'eq 1.2s ease-in-out infinite',
        'eq-2': 'eq 1.5s ease-in-out 0.2s infinite',
        'eq-3': 'eq 1.0s ease-in-out 0.4s infinite',
        'eq-4': 'eq 1.3s ease-in-out 0.1s infinite',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateX(-20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        bounceIn: {
          '0%': { transform: 'scale(0.3)', opacity: '0' },
          '50%': { transform: 'scale(1.05)' },
          '70%': { transform: 'scale(0.9)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(29, 185, 84, 0.3)' },
          '100%': { boxShadow: '0 0 40px rgba(29, 185, 84, 0.6), 0 0 80px rgba(29, 185, 84, 0.2)' },
        },
        eq: {
          '0%, 100%': { height: '4px' },
          '50%': { height: '20px' },
        },
      },
    },
  },
  plugins: [],
};
