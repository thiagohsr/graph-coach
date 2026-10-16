import type { MeDto } from '@coach/types';
import { Link } from '@tanstack/react-router';
import { MenuIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '~/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '~/components/ui/sheet';
import { roleAtLeast } from '~/lib/auth/guards';
import { useSignOut } from '~/lib/auth/use-sign-out';

interface NavItem {
  to: string;
  label: string;
  adminOnly?: boolean;
}

// The routes behind these links arrive with the stories (Puzzles first); links are typed loosely until then.
const NAV_ITEMS: NavItem[] = [
  { to: '/puzzles', label: 'Puzzles' },
  { to: '/coach', label: 'Coach' },
  { to: '/mastery', label: 'Mastery' },
  { to: '/sources', label: 'Sources' },
  { to: '/review', label: 'Review' },
  { to: '/admin', label: 'Admin', adminOnly: true },
];

export function visibleNavItems(user: Pick<MeDto, 'role'>): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || roleAtLeast(user.role, 'admin'));
}

function NavLinks({ user, onNavigate, orientation }: { user: Pick<MeDto, 'role'>; onNavigate?: () => void; orientation: 'row' | 'column' }) {
  return (
    <ul className={orientation === 'row' ? 'flex items-center gap-1' : 'flex flex-col gap-1'}>
      {visibleNavItems(user).map((item) => (
        <li key={item.to}>
          <Link
            to={item.to as never}
            onClick={onNavigate}
            className="inline-flex min-h-10 w-full items-center rounded-md px-3 text-sm text-text-secondary transition-colors duration-(--duration-fast) hover:bg-accent hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:font-semibold aria-[current=page]:text-foreground max-sm:min-h-11"
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function BrandMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" className="shrink-0">
      <path d="M6 19 L13 6 L20 17" className="stroke-primary" strokeWidth="2" fill="none" />
      <circle cx="6" cy="19" r="3.5" className="fill-primary" />
      <circle cx="13" cy="6" r="3.5" className="fill-graph" />
      <circle cx="20" cy="17" r="3.5" className="fill-card stroke-primary" strokeWidth="2" />
    </svg>
  );
}

function UserMenu({ user }: { user: MeDto }) {
  const [open, setOpen] = useState(false);
  const signOut = useSignOut();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label="User menu">
          <span className="hidden max-w-32 truncate text-text-secondary sm:inline">{user.name}</span>
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-primary-soft text-[13px] font-bold text-primary">
            {initials(user.name)}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{user.name}</SheetTitle>
          <SheetDescription>
            {user.email} · {user.role}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4">
          {/* The /account route arrives with the allowance story. */}
          <Link to={'/account' as never} onClick={() => setOpen(false)} className="inline-flex min-h-10 items-center rounded-md px-3 text-sm hover:bg-accent">
            Account
          </Link>
          <Button type="button" variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Frame of every signed-in screen (contracts/ui-screens.md "Shell"). */
export function AppShell({ user, children }: { user: MeDto; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:outline-solid focus:outline-3 focus:outline-offset-2 focus:outline-ring focus:shadow-sm"
      >
        Skip to content
      </a>
      <header className="flex min-h-14 items-center justify-between gap-2 border-b bg-card px-4 py-2 sm:min-h-[60px] sm:px-8">
        <div className="flex items-center gap-2 sm:gap-7">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="md:hidden">
                <MenuIcon aria-hidden="true" />
                Menu
              </Button>
            </SheetTrigger>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
                <SheetDescription className="sr-only">Site navigation</SheetDescription>
              </SheetHeader>
              <nav aria-label="Main" className="px-4">
                <NavLinks user={user} orientation="column" onNavigate={() => setMenuOpen(false)} />
              </nav>
            </SheetContent>
          </Sheet>
          <span className="flex items-center gap-2.5 text-[17px] font-bold">
            <BrandMark />
            Graph Coach
          </span>
          <nav aria-label="Main" className="hidden md:block">
            <NavLinks user={user} orientation="row" />
          </nav>
        </div>
        <UserMenu user={user} />
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-8 sm:px-8 sm:pt-7">
        {children}
      </main>
    </div>
  );
}
