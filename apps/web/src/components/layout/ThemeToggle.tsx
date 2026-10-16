import { MoonIcon, SunIcon } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { useTheme } from '~/lib/theme/theme';

/** Switches between light and dark. The label names the theme it switches to; the icon is decorative. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} theme`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-9 max-sm:size-11"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      {theme === 'dark' ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
    </Button>
  );
}
