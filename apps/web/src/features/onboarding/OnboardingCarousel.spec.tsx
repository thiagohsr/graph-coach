import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingCarousel } from './OnboardingCarousel';
import { SLIDES } from './slides';

function mockMedia({ reduce = false, dark = false } = {}) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: (reduce && query.includes('reduce')) || (dark && query.includes('dark')),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

function setup(options: Parameters<typeof mockMedia>[0] = {}) {
  mockMedia(options);
  const onClose = vi.fn();
  render(<OnboardingCarousel open onClose={onClose} />);
  return { onClose, user: userEvent.setup() };
}

const heading = () => screen.getByRole('dialog').querySelector('[data-slot="dialog-title"]')!;

describe('OnboardingCarousel', () => {
  it('renders nothing while closed', () => {
    mockMedia();
    render(<OnboardingCarousel open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as a modal dialog on slide 1 with the headline as its name and focus on it', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: SLIDES[0]!.headline });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText(SLIDES[0]!.body)).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-position')).toHaveTextContent('1 of 7');
    expect(heading()).toHaveFocus();
  });

  it('moves with Next and Back, announces the slide, and shows the position as text', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: SLIDES[1]!.headline })).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-position')).toHaveTextContent('2 of 7');
    expect(screen.getByRole('status')).toHaveTextContent(`Slide 2 of 7: ${SLIDES[1]!.headline}`);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: SLIDES[0]!.headline })).toBeInTheDocument();
  });

  it('moves with the arrow keys; Left on slide 1 does nothing', async () => {
    const { user, onClose } = setup();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('onboarding-position')).toHaveTextContent('1 of 7');
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(screen.getByTestId('onboarding-position')).toHaveTextContent('4 of 7');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('onboarding-position')).toHaveTextContent('3 of 7');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('has dots with aria-current that jump to a slide', async () => {
    const { user } = setup();
    const group = screen.getByRole('group', { name: 'Slides' });
    const dots = within(group).getAllByRole('button');
    expect(dots).toHaveLength(7);
    expect(dots[0]).toHaveAttribute('aria-current', 'step');
    await user.click(dots[4]!);
    expect(dots[4]).toHaveAttribute('aria-current', 'step');
    expect(dots[0]).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('dialog', { name: SLIDES[4]!.headline })).toBeInTheDocument();
  });

  it.each([
    [
      'Skip',
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByRole('button', { name: 'Skip' })),
    ],
    ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    [
      'Back on slide 1',
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByRole('button', { name: 'Back' })),
    ],
    [
      'the close control',
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByRole('button', { name: 'Close' })),
    ],
  ])('%s counts as skipped', async (_name, act) => {
    const { user, onClose } = setup();
    await act(user);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith({ outcome: 'skipped' });
  });

  it('replaces Next with "Play a puzzle" on the last slide, plus a "Create a puzzle" alternative', async () => {
    const { user, onClose } = setup();
    await user.keyboard('{ArrowRight>6/}');
    expect(screen.getByTestId('onboarding-position')).toHaveTextContent('7 of 7');
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Play a puzzle' }));
    expect(onClose).toHaveBeenCalledWith({ outcome: 'completed', to: '/puzzles' });
  });

  it('"Create a puzzle" completes and goes to /sources/new', async () => {
    const { user, onClose } = setup();
    for (let i = 0; i < 6; i += 1) await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Create a puzzle' }));
    expect(onClose).toHaveBeenCalledWith({ outcome: 'completed', to: '/sources/new' });
  });

  it('keeps focus inside the dialog while tabbing', async () => {
    const { user } = setup();
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 20; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('animates slide changes unless the user prefers reduced motion', () => {
    setup();
    expect(screen.getByRole('dialog').querySelector('[data-motion]')).toHaveAttribute(
      'data-motion',
      'slide',
    );
  });

  it('does not animate under prefers-reduced-motion', () => {
    setup({ reduce: true });
    const slide = screen.getByRole('dialog').querySelector('[data-motion]')!;
    expect(slide).toHaveAttribute('data-motion', 'none');
    expect(slide.className).not.toMatch(/animate-in|slide-in/);
  });

  it('shows the placeholder, never a broken image, when the picture fails', () => {
    setup();
    const placeholder = screen.getByTestId('slide-placeholder');
    expect(placeholder).toHaveAccessibleName(SLIDES[0]!.alt);
    const img = screen.getByTestId('slide-image').querySelector('img')!;
    expect(img).toHaveAttribute('src', '/onboarding/slide-1.webp');
    fireEvent.error(img);
    expect(screen.getByTestId('slide-image').querySelector('img')).toBeNull();
    expect(screen.getByTestId('slide-placeholder')).toBeVisible();
  });

  it('uses the picture, and hides the placeholder from assistive tech, once it loads', () => {
    setup();
    const img = screen.getByTestId('slide-image').querySelector('img')!;
    fireEvent.load(img);
    expect(img).toHaveAttribute('alt', SLIDES[0]!.alt);
    expect(img.className).not.toContain('invisible');
    expect(screen.getByTestId('slide-placeholder').parentElement).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('under a dark scheme tries the dark file first, then falls back to the light one', () => {
    setup({ dark: true });
    const box = screen.getByTestId('slide-image');
    expect(box.querySelector('img')).toHaveAttribute('src', '/onboarding/slide-1-dark.webp');
    fireEvent.error(box.querySelector('img')!);
    expect(box.querySelector('img')).toHaveAttribute('src', '/onboarding/slide-1.webp');
    fireEvent.error(box.querySelector('img')!);
    expect(box.querySelector('img')).toBeNull();
  });
});
