import { Link } from '@tanstack/react-router';
import { ThemeToggle } from '~/components/layout/ThemeToggle';
import {
  BrainCircuit,
  FileText,
  GitBranch,
  Lock,
  Mail,
  Puzzle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandMark } from '~/components/layout/AppShell';
import { buttonVariants } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import { HeroGraph } from './HeroGraph';
import { WhyShowcase } from './WhyShowcase';

export type AuthMode = 'cognito' | 'dev';

const AFTER_SIGN_IN = '/puzzles';

/** The same plain links the /login page uses: the hosted page does sign-up and sign-in, we store no credentials. */
export function authUrl(provider: 'google' | 'email'): string {
  return `/auth/login?provider=${provider}&redirect=${encodeURIComponent(AFTER_SIGN_IN)}`;
}

const focusRing =
  'outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring';

const STEPS: { icon: typeof Puzzle; title: string; text: string }[] = [
  {
    icon: Puzzle,
    title: 'Play',
    text: 'Fill in the blank. Short puzzles, instant feedback, no streak pressure.',
  },
  {
    icon: GitBranch,
    title: 'The graph remembers',
    text: 'Every answer updates your mastery of each concept in a knowledge graph.',
  },
  {
    icon: BrainCircuit,
    title: 'The Coach picks your next one',
    text: 'It walks the graph to your weakest link, then shows you "Why this?".',
  },
  {
    icon: Sparkles,
    title: 'Make your own',
    text: 'Turn your notes or a short prompt into new puzzles. Review them, then keep them or share by e-mail.',
  },
];

export function LandingPage({ mode }: { mode: AuthMode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className={cn(
          'sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg',
          focusRing,
        )}
      >
        Skip to content
      </a>
      <header className="border-b bg-background/90">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            to="/"
            className={cn('flex items-center gap-2 rounded-md text-lg font-bold', focusRing)}
          >
            <BrandMark />
            <span>Graph Coach</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-3">
            <a
              href="#how-it-works"
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            >
              How it works
            </a>
            <ThemeToggle />
            <Link to="/login" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        <section
          aria-labelledby="hero-title"
          className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[1fr_1.1fr] lg:gap-12 lg:py-20"
        >
          <div className="flex flex-col gap-6">
            <p className="font-mono text-xs font-medium tracking-[0.08em] text-graph uppercase">
              A study coach built on a knowledge graph
            </p>
            <h1
              id="hero-title"
              className="text-[2.25rem] leading-[1.1] font-bold tracking-tight text-balance sm:text-5xl"
            >
              Study with a coach that remembers what you know.
            </h1>
            <p className="max-w-xl text-lg text-text-secondary">
              Play fill-in-the-blank puzzles. Our AI coach tracks your mastery in a graph, picks
              what to practise next, and shows you exactly why.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a href="#start" className={cn(buttonVariants({ size: 'lg' }))}>
                Start learning — it&rsquo;s free
              </a>
              <Link to="/login" className={cn(buttonVariants({ size: 'lg', variant: 'outline' }))}>
                Sign in
              </Link>
            </div>
            <p className="text-sm text-muted-foreground">
              Free plan: 3 creations from uploads and 3 from prompts every month.
            </p>
          </div>
          <HeroGraph />
        </section>

        <section
          id="how-it-works"
          aria-labelledby="how-title"
          className="scroll-mt-4 border-y bg-muted/60"
        >
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <h2 id="how-title" className="text-2xl font-bold tracking-tight sm:text-3xl">
              How it works
            </h2>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ icon: Icon, title, text }, i) => (
                <li
                  key={title}
                  className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-xs"
                >
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary"
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="font-mono text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase">
                      Step {i + 1}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="text-sm text-text-secondary">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          aria-labelledby="why-title"
          className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16"
        >
          <h2 id="why-title" className="text-2xl font-bold tracking-tight sm:text-3xl">
            Never a mystery recommendation
          </h2>
          <p className="mt-2 max-w-2xl text-text-secondary">
            Every pick comes with its reasoning: the weak spot, how concepts connect, and the puzzle
            that fixes it. Open &ldquo;Why this?&rdquo; any time.
          </p>
          <div className="mt-6">
            <WhyShowcase />
          </div>
        </section>

        <section
          id="start"
          aria-labelledby="start-title"
          className="scroll-mt-4 border-y bg-muted/60"
        >
          <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:gap-14">
            <div className="flex flex-col gap-4">
              <h2 id="start-title" className="text-2xl font-bold tracking-tight sm:text-3xl">
                Create your free account
              </h2>
              <p className="text-text-secondary">
                Your first sign-in creates your account. Sign-up and sign-in happen on a secure
                hosted page; Graph Coach never sees or stores your password.
              </p>
              <ul className="flex flex-col gap-3 text-sm">
                <Perk icon={<Sparkles className="size-4" />}>
                  Free every month: 3 creations from uploads and 3 from prompts.
                </Perk>
                <Perk icon={<Lock className="size-4" />}>
                  Your uploads are private. Only you can see your sources.
                </Perk>
                <Perk icon={<Mail className="size-4" />}>
                  Share puzzles by e-mail, privately, only with people you choose.
                </Perk>
              </ul>
            </div>
            <SignInPanel mode={mode} />
          </div>
        </section>

        <section aria-labelledby="trust-title" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <h2 id="trust-title" className="sr-only">
            Privacy and trust
          </h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            <Perk icon={<ShieldCheck className="size-5" />} large>
              No passwords stored. Google or e-mail sign-in, handled by a hosted identity service.
            </Perk>
            <Perk icon={<FileText className="size-5" />} large>
              Your notes become puzzles you review and approve before you play or share them.
            </Perk>
            <Perk icon={<GitBranch className="size-5" />} large>
              Transparent by design: every recommendation can be traced through the graph.
            </Perk>
          </ul>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-text-secondary sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Built on FalkorDB for Graph Hacks.</p>
          <nav aria-label="Footer" className="flex gap-4">
            <Link
              to="/login"
              className={cn('rounded-sm font-medium underline underline-offset-4', focusRing)}
            >
              Sign in
            </Link>
            <a
              href="#start"
              className={cn('rounded-sm font-medium underline underline-offset-4', focusRing)}
            >
              Create an account
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Perk({
  icon,
  children,
  large,
}: {
  icon: ReactNode;
  children: ReactNode;
  large?: boolean;
}) {
  return (
    <li
      className={cn(
        'flex items-start gap-3',
        large && 'rounded-xl border bg-card p-4 text-sm text-text-secondary shadow-xs',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('mt-0.5 shrink-0', large ? 'text-primary' : 'text-graph')}
      >
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** Sign-up / sign-in entry: plain links to the existing auth flow. In dev mode the dev account picker lives at /login. */
export function SignInPanel({ mode }: { mode: AuthMode }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-sm">
      <h3 className="text-xl font-semibold">Get started</h3>
      {mode === 'cognito' ? (
        <>
          <div className="flex flex-col gap-3">
            <a href={authUrl('google')} className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
              Continue with Google
            </a>
            <a
              href={authUrl('email')}
              className={cn(buttonVariants({ size: 'lg', variant: 'outline' }), 'w-full')}
            >
              Sign up with e-mail
            </a>
          </div>
          <p className="text-sm text-text-secondary">
            Already have an account?{' '}
            <a
              href={authUrl('email')}
              className={cn(
                'rounded-sm font-medium text-primary underline underline-offset-4',
                focusRing,
              )}
            >
              Sign in with e-mail
            </a>
          </p>
        </>
      ) : (
        <>
          <p className="rounded-md border border-dashed border-input bg-muted px-3 py-2 text-sm">
            Development mode: pick a demo account instead of a real sign-in.
          </p>
          <Link to="/login" className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
            Choose a demo account
          </Link>
        </>
      )}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        Your uploads are private. Only you can see your sources.
      </p>
    </div>
  );
}
