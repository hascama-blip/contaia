import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Azul corporativo ASENCO (primario).
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          200: "#bcd9ff",
          300: "#8ec0ff",
          400: "#599cff",
          500: "#3377ff",
          600: "#1f56f5",
          700: "#1842e1",
          800: "#1a37b6",
          900: "#1b338f",
        },
        // Acento cian/turquesa (innovador) para gradientes y CTAs secundarios.
        accent: {
          50: "#ecfeff",
          100: "#cffafe",
          200: "#a5f3fc",
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
          700: "#0e7490",
          800: "#155e75",
          900: "#164e63",
        },
      },
    },
  },
  plugins: [],
};

export default config;
