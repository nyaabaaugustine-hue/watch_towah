import type { Config } from "tailwindcss";

/**
 * Watchtower design tokens.
 *
 * The palette has four deliberate jobs and they must not blur into each other:
 *   watchtower.*  brand indigo->violet, the default surface for everything calm
 *   safe.*        the "you are protected" green state
 *   sos.*         the emergency red, reserved exclusively for the SOS affordance
 *   ghana.*       flag red/gold/green, used sparingly as identity, never as state
 *
 * A screen showing red is always an emergency. Nothing decorative is allowed to
 * use sos.* — that is what keeps the signal meaningful under stress.
 */
export default {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        watchtower: {
          50: "#F6F2FF",
          100: "#EDE4FF",
          200: "#DBCBFF",
          300: "#C2A5FF",
          400: "#A675FA",
          500: "#8B45F0",
          600: "#7C1FE0",
          700: "#6815B8",
          800: "#4B0FA8",
          900: "#3E0C88",
          950: "#260657",
        },
        safe: {
          50: "#ECFDF5",
          100: "#D1FAE5",
          200: "#A7F3D0",
          300: "#6EE7B7",
          400: "#34D399",
          500: "#10B981",
          600: "#059669",
          700: "#047857",
          800: "#065F46",
          900: "#064E3B",
        },
        sos: {
          50: "#FEF2F2",
          100: "#FEE2E2",
          200: "#FECACA",
          300: "#FCA5A5",
          400: "#F87171",
          500: "#E53935",
          600: "#C62828",
          700: "#A02020",
          800: "#7F1919",
          900: "#5F1313",
        },
        ghana: {
          red: "#CE1126",
          gold: "#FCD116",
          green: "#006B3F",
        },
        ink: {
          DEFAULT: "#14121C",
          muted: "#5B5872",
          faint: "#8F8CA6",
          surface: "#FFFFFF",
          canvas: "#F7F5FD",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Heavy, tight display sizes for the status headline and SOS label.
        display: ["clamp(1.75rem, 6vw, 2.5rem)", { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "900" }],
        title: ["1.5rem", { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "800" }],
        section: ["1.0625rem", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "700" }],
      },
      borderRadius: {
        card: "1.25rem",
        pill: "999px",
      },
      boxShadow: {
        card: "0 1px 2px rgb(20 18 28 / 0.04), 0 8px 24px -12px rgb(20 18 28 / 0.12)",
        lift: "0 2px 4px rgb(20 18 28 / 0.06), 0 16px 40px -16px rgb(20 18 28 / 0.22)",
        sos: "0 0 0 8px rgb(229 57 53 / 0.14), 0 12px 32px -8px rgb(229 57 53 / 0.45)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #4B0FA8 0%, #7C1FE0 55%, #A675FA 100%)",
        "ghana-stripe": "linear-gradient(90deg, #CE1126 0% 33.33%, #FCD116 33.33% 66.66%, #006B3F 66.66% 100%)",
      },
      keyframes: {
        "sos-pulse": {
          "0%": { transform: "scale(1)", opacity: "0.55" },
          "70%": { transform: "scale(1.28)", opacity: "0" },
          "100%": { transform: "scale(1.28)", opacity: "0" },
        },
        "sos-flash": {
          "0%, 100%": { backgroundColor: "#E53935" },
          "50%": { backgroundColor: "#A02020" },
        },
        "safe-breathe": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.65" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "sos-pulse": "sos-pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "sos-flash": "sos-flash 1.1s ease-in-out infinite",
        "safe-breathe": "safe-breathe 3.4s ease-in-out infinite",
        "slide-up": "slide-up 0.32s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
