import { useCallback, useSyncExternalStore } from 'react';

/**
 * Light or dark theme. The default follows the system setting; a choice made with the toggle is kept in this
 * browser (localStorage, a per-viewer convenience) and wins over the system. The resolved theme is written to
 * `<html data-theme>`, which app.css keys every dark token and the `dark:` variant on.
 */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'gc-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const CHANGE_EVENT = 'gc-theme-change';

/**
 * Runs in <head> before the first paint (root route), so a stored or system dark theme never flashes light.
 * Kept dependency-free and wrapped in try/catch: storage can be blocked.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia('${DARK_QUERY}').matches?'dark':'light'}var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t}catch(e){}})();`;

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function subscribe(callback: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  // Without a stored choice the page follows the system as it changes.
  const onSystem = () => {
    if (storedTheme() === null) apply(systemTheme());
    callback();
  };
  media.addEventListener('change', onSystem);
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    media.removeEventListener('change', onSystem);
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

/** The resolved theme and a setter that stores the choice. The server render assumes light. */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const theme = useSyncExternalStore(subscribe, resolveTheme, () => 'light' as Theme);
  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
    apply(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return { theme, setTheme };
}
