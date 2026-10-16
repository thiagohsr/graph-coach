import { PROMPT_ORIGIN_NOTICE } from '@coach/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', async (orig) =>
  (await import('~/test/router-mock')).routerMock(await orig()),
);

import { PlayHeader } from '~/features/play/PlayBoard';
import { OriginLabel } from './OriginLabel';
import { originLabel } from './origin';

describe('OriginLabel', () => {
  it('renders the shared prompt notice for a prompt origin, as visible text', () => {
    render(<OriginLabel origin="prompt" />);
    expect(screen.getByText(PROMPT_ORIGIN_NOTICE)).toBeVisible();
  });

  it('renders "From your material" for an owner and "From uploaded material" otherwise', () => {
    const { unmount } = render(<OriginLabel origin="upload" access="owner" />);
    expect(screen.getByText('From your material')).toBeInTheDocument();
    unmount();
    const shared = render(<OriginLabel origin="upload" access="shared" />);
    expect(screen.getByText('From uploaded material')).toBeInTheDocument();
    shared.unmount();
    render(<OriginLabel origin="upload" access="public" />);
    expect(screen.getByText('From uploaded material')).toBeInTheDocument();
  });

  it('renders "Seeded puzzle" for a seed origin', () => {
    render(<OriginLabel origin="seed" access="public" />);
    expect(screen.getByText('Seeded puzzle')).toBeInTheDocument();
  });

  it('originLabel is the one wording', () => {
    expect(originLabel('prompt')).toBe(PROMPT_ORIGIN_NOTICE);
    expect(originLabel('upload')).toBe('From uploaded material');
    expect(originLabel('seed')).toBe('Seeded puzzle');
  });

  it('the play header shows the prompt notice from the play payload origin, and nothing for other origins', () => {
    const { unmount } = render(<PlayHeader puzzle={{ name: 'Trees', origin: 'prompt' }} />);
    expect(screen.getByRole('heading', { name: 'Trees' })).toBeInTheDocument();
    expect(screen.getByText(PROMPT_ORIGIN_NOTICE)).toBeInTheDocument();
    unmount();
    render(<PlayHeader puzzle={{ name: 'Trees', origin: 'upload' }} />);
    expect(screen.queryByText(PROMPT_ORIGIN_NOTICE)).not.toBeInTheDocument();
  });
});
