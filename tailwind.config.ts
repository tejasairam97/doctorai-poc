import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17201a",
        moss: "#355c47",
        mint: "#d9f2e5",
        clinic: "#f6faf7",
        coral: "#d96459",
        amberline: "#d79b34"
      },
      boxShadow: {
        soft: "0 12px 40px rgba(23, 32, 26, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
