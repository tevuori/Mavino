import containerQueries from "@tailwindcss/container-queries";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  safelist: [
    // CollapsibleSidebar constructs container-query variant classes at runtime
    // from a `showAt` prop (e.g. "@5xl:hidden"). Tailwind's scanner can't see
    // dynamically built class names, and safelist regex patterns don't match
    // container-query variant prefixes, so list them explicitly here.
    "@sm:hidden", "@sm:flex", "@sm:inline", "@sm:block", "@sm:static", "@sm:z-auto", "@sm:shadow-none", "@sm:text-4xl", "@sm:max-w-[260px]",
    "@2xl:hidden", "@2xl:flex", "@2xl:inline", "@2xl:block", "@2xl:static", "@2xl:z-auto", "@2xl:shadow-none",
    "@3xl:hidden", "@3xl:flex", "@3xl:inline", "@3xl:block", "@3xl:static", "@3xl:z-auto", "@3xl:shadow-none",
    "@4xl:hidden", "@4xl:flex", "@4xl:inline", "@4xl:block", "@4xl:static", "@4xl:z-auto", "@4xl:shadow-none",
    "@5xl:hidden", "@5xl:flex", "@5xl:inline", "@5xl:block", "@5xl:static", "@5xl:z-auto", "@5xl:shadow-none",
    "@6xl:hidden", "@6xl:flex", "@6xl:inline", "@6xl:block", "@6xl:static", "@6xl:z-auto", "@6xl:shadow-none",
    "@7xl:hidden", "@7xl:flex", "@7xl:inline", "@7xl:block", "@7xl:static", "@7xl:z-auto", "@7xl:shadow-none",
  ],
  theme: {
    extend: {
      colors: {
        // Accent color driven by CSS var --accent (set at runtime by Settings)
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          fg: "rgb(var(--accent-fg) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          2: "rgb(var(--surface-2) / <alpha-value>)",
          3: "rgb(var(--surface-3) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          muted: "rgb(var(--ink-muted) / <alpha-value>)",
        },
        edge: "rgb(var(--edge) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
        // Mobile-only display face for headlines — see .mobile-shell brand tokens in index.css.
        display: ["\"Space Grotesk\"", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        window: "0 10px 40px -8px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.25)",
        panel: "0 4px 20px -4px rgba(0,0,0,0.4)",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.25s ease-out",
        "scale-in": "scaleIn 0.18s ease-out",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
        "progress-slide": "progressSlide 1.4s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        scaleIn: { from: { opacity: "0", transform: "scale(0.96)" }, to: { opacity: "1", transform: "scale(1)" } },
        pulseSoft: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.6" } },
        progressSlide: {
          "0%": { transform: "translateX(-100%)" },
          "50%": { transform: "translateX(150%)" },
          "100%": { transform: "translateX(150%)" },
        },
      },
    },
  },
  plugins: [containerQueries],
};
