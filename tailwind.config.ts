import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Azul marino corporativo ASENCO (primario) — tomado de asencoauditores.com.
        brand: {
          50: "#eef3fa",
          100: "#d3e0f0",
          200: "#a7c0e0",
          300: "#6f98c9",
          400: "#3f6ca8",
          500: "#234d82",
          600: "#173a66",
          700: "#102b4d",
          800: "#0b2140",
          900: "#081a33",
        },
        // Dorado / oro (acento de la marca) para CTAs y detalles llamativos.
        accent: {
          50: "#fdf8e7",
          100: "#fbedbf",
          200: "#f6db84",
          300: "#f1c945",
          400: "#edb91e",
          500: "#dca200",
          600: "#b98600",
          700: "#946708",
          800: "#7a5410",
          900: "#674612",
        },
      },
    },
  },
  plugins: [],
};

export default config;
