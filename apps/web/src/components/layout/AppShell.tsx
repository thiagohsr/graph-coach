import type { MeDto } from '@coach/types';
import { Link } from '@tanstack/react-router';
import { MenuIcon, UserIcon } from 'lucide-react';
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
            className="inline-flex min-h-10 w-full items-center rounded-md px-3 text-sm font-medium hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:underline"
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function UserMenu({ user }: { user: MeDto }) {
  const [open, setOpen] = useState(false);
  const signOut = useSignOut();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label="User menu">
          <UserIcon aria-hidden="true" />
          <span className="hidden max-w-32 truncate sm:inline">{user.name}</span>
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
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
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
          <span className="font-semibold">Graph Coach</span>
          <nav aria-label="Main" className="hidden md:block">
            <NavLinks user={user} orientation="row" />
          </nav>
        </div>
        <UserMenu user={user} />
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 p-4">
        {children}
      </main>
    </div>
  );
}
