"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/store";

/**
 * Applies the `mode-classic` class to <html> when the active session is in
 * Classic mode (CSV/XLSX), and removes it otherwise. This swaps the entire
 * color palette via the .mode-classic overrides in globals.css.
 *
 * The dark-mode class is managed by next-themes (see ThemeProvider). The two
 * classes coexist: `<html class="mode-classic dark">` → classic dark palette.
 */
export function ModeClassSync() {
  const mode = useSession((s) => s.mode);
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "classic") root.classList.add("mode-classic");
    else root.classList.remove("mode-classic");
  }, [mode]);
  return null;
}
