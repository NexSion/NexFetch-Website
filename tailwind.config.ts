import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#05070d",
        panel: "#0b0e17",
        line: "#1c2233",
        blue: {
          glow: "#3b82f6",
          deep: "#1d4ed8"
        },
        violet: {
          glow: "#8b5cf6",
          deep: "#6d28d9"
        }
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"]
      },
      backgroundImage: {
        "nex-gradient": "linear-gradient(135deg, #1d4ed8 0%, #6d28d9 60%, #a855f7 100%)",
        "nex-radial": "radial-gradient(circle at 20% 20%, rgba(59,130,246,0.18), transparent 45%), radial-gradient(circle at 80% 0%, rgba(139,92,246,0.16), transparent 40%)"
      }
    }
  },
  plugins: []
};
export default config;
