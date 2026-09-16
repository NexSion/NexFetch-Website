import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Legacy tokens — still used across dashboard/account/pricing/etc,
        // kept so those untouched pages don't lose their styling. Remove
        // once every page has migrated to the tokens below.
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
        },

        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))"
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))"
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))"
        }
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      fontFamily: {
        display: ["var(--font-instrument-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        body: ["var(--font-instrument-sans)", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      backgroundImage: {
        "nex-gradient": "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(226 100% 50%) 100%)",
        "nex-radial": "radial-gradient(circle at 20% 15%, hsl(var(--primary) / 0.14), transparent 45%)"
      }
    }
  },
  plugins: []
};
export default config;
