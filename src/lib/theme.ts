import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
export const THEME_KEY = "pt-theme";

/**
 * Runs in <head> before the page paints, so the saved theme is applied with no flash.
 * Must stay tiny and dependency-free.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');var d=t==='dark';var r=document.documentElement;if(d){r.classList.add('dark');}r.style.colorScheme=d?'dark':'light';var m=document.querySelector('meta[name="theme-color"]');if(m&&d){m.setAttribute('content','#000000');}}catch(e){}})();`;

const listeners = new Set<() => void>();

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute("content", theme === "dark" ? "#000000" : "#0b1b3a"));
}

export function setTheme(theme: Theme) {
  apply(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage may be blocked; the theme still applies for this visit */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY) {
      apply(e.newValue === "dark" ? "dark" : "light");
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);
  const toggle = useCallback(() => setTheme(readTheme() === "dark" ? "light" : "dark"), []);
  return { theme, setTheme, toggle };
}
