import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY, resolveTheme, themeInitScript, useTheme } from './theme';

function systemDark(dark: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: dark && query.includes('dark'),
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
});

describe('theme', () => {
  it('follows the system when nothing is stored', () => {
    systemDark(true);
    expect(resolveTheme()).toBe('dark');
    systemDark(false);
    expect(resolveTheme()).toBe('light');
  });

  it('a stored choice wins over the system', () => {
    systemDark(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(resolveTheme()).toBe('light');
  });

  it('ignores a stored value that is not a theme', () => {
    systemDark(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(resolveTheme()).toBe('dark');
  });

  it('setTheme stores the choice and writes data-theme and color-scheme on <html>', () => {
    systemDark(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    act(() => result.current.setTheme('dark'));
    expect(result.current.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('the head script applies the stored theme before React runs', () => {
    systemDark(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(themeInitScript)();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('the head script falls back to the system theme', () => {
    systemDark(true);
    new Function(themeInitScript)();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
