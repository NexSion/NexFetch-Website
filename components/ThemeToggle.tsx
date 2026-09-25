"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("nexfetch:theme");
    const dark = stored ? stored === "dark" : true;
    setIsDark(dark);
    document.documentElement.classList.toggle("light", !dark);
  }, []);

  function toggle() {
    setIsDark((prev) => {
      const next = !prev;
      localStorage.setItem("nexfetch:theme", next ? "dark" : "light");
      document.documentElement.classList.toggle("light", !next);
      return next;
    });
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-white/70 hover:border-blue-glow/60 hover:text-white transition-colors"
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.75">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.75">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
