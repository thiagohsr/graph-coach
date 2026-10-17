import { Link, createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { BrandMark } from '~/components/layout/AppShell';
import { ThemeToggle } from '~/components/layout/ThemeToggle';

/** Where privacy requests go (access, correction, deletion). Shown on the page and used as a mailto link. */
export const PRIVACY_CONTACT_EMAIL = 'thiagoramos@gmail.com';
const UPDATED = '17 October 2026';

export const Route = createFileRoute('/privacy')({
  // Public: signed-out visitors (and Google's consent screen) link here.
  head: () => ({
    meta: [
      { title: 'Privacy · Graph Coach' },
      {
        name: 'description',
        content: 'What Graph Coach stores, why, who processes it, and how to have it deleted.',
      },
    ],
  }),
  component: PrivacyPage,
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex flex-col gap-2 text-text-secondary">{children}</div>
    </section>
  );
}

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 text-[17px] font-bold">
            <BrandMark />
            Graph Coach
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="mx-auto flex max-w-3xl flex-col gap-7 px-4 py-8 leading-7 sm:px-6">
        <RouteFocus title="Privacy" />
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">Privacy</h1>
          <p className="text-sm text-muted-foreground">Last updated {UPDATED}</p>
          <p className="text-text-secondary">
            Graph Coach is a study coach built as a demonstration for the Graph Hacks hackathon.
            This page says what it stores about you, why, who else processes it, and how to have it
            deleted. The site holds demonstration content and may be reset or shut down at any time.
          </p>
        </div>

        <Section title="What we store">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Your account:</strong> your e-mail address, your name as your sign-in provider
              gives it, your role, and how many puzzles you created this month. Kept in our accounts
              database only; e-mail addresses are never put in the learning graph, logs, or prompts.
            </li>
            <li>
              <strong>Your learning:</strong> the puzzles you play, your answers, your mastery of
              each concept, and the Coach&apos;s recommendations with the reasons behind them. Kept
              in the learning graph, linked to an account id, not your e-mail.
            </li>
            <li>
              <strong>What you upload or describe:</strong> the text you paste or upload, and the
              subject you describe when creating a puzzle, with the passages and questions made from
              it. Your sources are private: only you can read them, unless you share a puzzle with
              someone and choose to include its source.
            </li>
            <li>
              <strong>Sharing:</strong> when you share a puzzle by e-mail, we record who can play
              it. The person must already have signed in once.
            </li>
          </ul>
          <p>
            Concept names and short descriptions taken from your material become part of a shared
            map of concepts that every learner uses. The text of your material does not.
          </p>
        </Section>

        <Section title="Sign-in">
          <p>
            Sign-in is handled by Amazon Cognito, with Google or with an e-mail address and
            password. Graph Coach never stores your password. When you continue with Google, Google
            shares your name and e-mail address with us, nothing else.
          </p>
        </Section>

        <Section title="Who processes your data">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Amazon Web Services</strong> (United States, us-east-1): hosting, databases,
              backups, and sign-in (Cognito).
            </li>
            <li>
              <strong>AI models:</strong> to create puzzles, the text you upload or describe is sent
              to a language model, first one run by the site owner, otherwise through OpenRouter to
              the model provider (currently OpenAI&apos;s gpt-4o-mini). Text is also sent through
              OpenRouter to an embedding model (Qwen) so related passages can be found. No account
              details are sent with it.
            </li>
            <li>
              <strong>Usage tracing</strong> (Langfuse), when enabled: only counts of model calls
              and tokens, never your text.
            </li>
          </ul>
        </Section>

        <Section title="Cookies and browser storage">
          <p>
            One sign-in cookie keeps you signed in. It is encrypted and cannot be read by scripts on
            the page. Your browser also remembers your light or dark theme choice and an unfinished
            puzzle, on your device only. There are no advertising or analytics cookies.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Until you ask us to delete it, or until the demonstration is reset or shut down,
            whichever comes first. Backups are kept for up to 30 days.
          </p>
        </Section>

        <Section title="Your choices">
          <p>
            To see, correct, or delete your data, including your account, e-mail{' '}
            <a
              className="font-medium text-primary underline underline-offset-4"
              href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
            >
              {PRIVACY_CONTACT_EMAIL}
            </a>{' '}
            from the address you sign in with. We answer within 30 days. Please upload only material
            you have the right to use.
          </p>
        </Section>

        <p className="border-t pt-5 text-sm text-muted-foreground">
          <Link to="/" className="font-medium underline underline-offset-4">
            Back to Graph Coach
          </Link>
        </p>
      </main>
    </div>
  );
}
