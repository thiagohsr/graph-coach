import { PROMPT_ORIGIN_NOTICE } from '@coach/types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sourceSummaries } from '~/features/sources/fixtures';
import { renderWithQuery } from '~/test/render';

vi.mock('@tanstack/react-router', async (orig) => (await import('~/test/router-mock')).routerMock(await orig()));

import { draft, drafts, outcome, PASSAGE } from './fixtures';
import { ReviewScreen } from './ReviewScreen';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const apiError = (code: string, message: string, details?: unknown) => ({
  error: { code, message, ...(details ? { details } : {}) },
});

type Handler = (init: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler> = {};

function serve(list = drafts, extra: Record<string, Handler> = {}) {
  handlers = {
    'GET /api/review/questions?status=draft': () => json(200, list),
    'GET /api/review/questions?status=draft&taskId=t-1': () => json(200, list),
    'GET /api/sources': () => json(200, sourceSummaries),
    ...extra,
  };
}

const calls = (method: string, urlPart: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init as RequestInit).method === method && String(url).includes(urlPart));

beforeEach(() => {
  handlers = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const handler = handlers[`${init.method} ${url}`];
    if (!handler) throw new Error(`unexpected fetch ${init.method} ${url}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('ReviewScreen', () => {
  it('shows sentence, answers, distractors, concepts and passage together; concepts are text, not inputs', async () => {
    serve();
    renderWithQuery(<ReviewScreen />);
    const draftRegion = await screen.findByRole('region', { name: 'Draft' });
    expect(within(draftRegion).getByRole('textbox', { name: 'Sentence' })).toHaveValue(drafts[0]!.sentence);
    expect(within(draftRegion).getByRole('textbox', { name: 'Answer 1' })).toHaveValue('index');
    expect(within(draftRegion).getByRole('textbox', { name: 'Answer 2' })).toHaveValue('writes');
    expect(within(draftRegion).getByRole('textbox', { name: 'Distractor 1' })).toHaveValue('cache');
    expect(within(draftRegion).getByText('Indexes')).toBeInTheDocument();
    expect(within(draftRegion).getByText('B-trees')).toBeInTheDocument();
    expect(within(draftRegion).queryByRole('textbox', { name: /Indexes|Concept/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Source passage' })).getByText(PASSAGE)).toBeInTheDocument();
    expect(screen.getByText('2 blanks · 2 answers')).toBeInTheDocument();
    expect(screen.getByText('Draft 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('2 drafts remaining')).toBeInTheDocument();
  });

  it('says "No source passage" when the passage is null', async () => {
    serve([draft({ passage: null })]);
    renderWithQuery(<ReviewScreen />);
    expect(await screen.findByText('No source passage is linked to this draft')).toBeInTheDocument();
  });

  it('shows the critic panel and the prompt notice, and never a passage, for a prompt draft', async () => {
    serve([draft({ origin: 'prompt', passage: null, critique: { verdict: 'rewrite', note: 'Too easy to guess.' } })]);
    renderWithQuery(<ReviewScreen />);
    const critic = await screen.findByRole('region', { name: "Critic's check" });
    expect(within(critic).getByText('rewrite')).toBeInTheDocument();
    expect(within(critic).getByText('Too easy to guess.')).toBeInTheDocument();
    expect(screen.getByText(PROMPT_ORIGIN_NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Source passage' })).not.toBeInTheDocument();
  });

  it('disables Save and Approve while the shared validator reports a blank/answer mismatch', async () => {
    serve();
    renderWithQuery(<ReviewScreen />);
    await screen.findByRole('region', { name: 'Draft' });
    await userEvent.click(screen.getByRole('button', { name: 'Remove answer 2' }));
    expect(await screen.findByText(/2 blanks but 1 answer/)).toBeInTheDocument();
    expect(screen.getByText('2 blanks · 1 answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('saves only the changed fields and replaces the draft in the cache', async () => {
    serve(drafts, {
      'PATCH /api/review/questions/d-1': (init) => {
        const body = JSON.parse(String(init.body)) as { distractors: string[] };
        return json(200, { ...drafts[0], distractors: body.distractors });
      },
    });
    renderWithQuery(<ReviewScreen />);
    await screen.findByRole('region', { name: 'Draft' });
    const input = screen.getByRole('textbox', { name: 'Distractor 2' });
    await userEvent.clear(input);
    await userEvent.type(input, 'view');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('PATCH', 'd-1')).toHaveLength(1));
    expect(JSON.parse(String((calls('PATCH', 'd-1')[0]![1] as RequestInit).body))).toEqual({ distractors: ['cache', 'view'] });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows a server 422 DRAFT_INVALID at the field after save', async () => {
    serve(drafts, {
      'PATCH /api/review/questions/d-1': () =>
        json(422, apiError('DRAFT_INVALID', 'The draft does not meet the rules', {
          reasons: ['sentence_length'],
          issues: [{ path: 'sentence', message: 'The server dislikes this sentence.', code: 'sentence_length' }],
        })),
    });
    renderWithQuery(<ReviewScreen />);
    await screen.findByRole('region', { name: 'Draft' });
    await userEvent.type(screen.getByRole('textbox', { name: 'Distractor 1' }), 's');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The server dislikes this sentence.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Distractor 1' })).toHaveValue('caches');
  });

  it('approve saves first when dirty, reads remainingDrafts, opens the next draft, and shows "Puzzle published"', async () => {
    serve(drafts, {
      'PATCH /api/review/questions/d-1': () => json(200, { ...drafts[0], distractors: ['cache', 'view'] }),
      'POST /api/review/questions/d-1/approve': () =>
        json(200, outcome({ puzzle: { id: 'pz-1', status: 'published', visibility: 'private', origin: 'upload' }, remainingDrafts: 1 })),
    });
    const { queryClient } = renderWithQuery(<ReviewScreen />);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await screen.findByRole('region', { name: 'Draft' });
    const input = screen.getByRole('textbox', { name: 'Distractor 2' });
    await userEvent.clear(input);
    await userEvent.type(input, 'view');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Puzzle published')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Play' })).toHaveAttribute('href', '/puzzles/pz-1/play');
    // saved before approving
    const order = fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit).method} ${url}`);
    expect(order.indexOf('PATCH /api/review/questions/d-1')).toBeLessThan(order.indexOf('POST /api/review/questions/d-1/approve'));
    // next draft open, remaining from the outcome
    expect(await screen.findByRole('textbox', { name: 'Sentence' })).toHaveValue(drafts[1]!.sentence);
    expect(screen.getByText('1 draft remaining')).toBeInTheDocument();
    expect(screen.getByText('Draft 1 of 1')).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['puzzles', 'list'] });
  });

  it('reject opens a dialog with an optional reason, sends it, and opens the next draft', async () => {
    serve(drafts, {
      'POST /api/review/questions/d-1/reject': () => json(200, outcome({ remainingDrafts: 1 })),
    });
    renderWithQuery(<ReviewScreen />);
    await screen.findByRole('region', { name: 'Draft' });
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'unclear');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject draft' }));
    await waitFor(() => expect(calls('POST', '/reject')).toHaveLength(1));
    expect(JSON.parse(String((calls('POST', '/reject')[0]![1] as RequestInit).body))).toEqual({ reason: 'unclear' });
    expect(await screen.findByDisplayValue(drafts[1]!.sentence)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Puzzle published')).not.toBeInTheDocument();
  });

  it('the final panel shows "published" with Play and a pointer to the puzzle list', async () => {
    serve([drafts[0]!], {
      'POST /api/review/questions/d-1/approve': () =>
        json(200, outcome({ puzzle: { id: 'pz-1', status: 'published', visibility: 'private', origin: 'upload' }, remainingDrafts: 0 })),
    });
    renderWithQuery(<ReviewScreen />);
    await screen.findByRole('region', { name: 'Draft' });
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('heading', { name: 'Puzzle published (private)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Play' })).toHaveAttribute('href', '/puzzles/pz-1/play');
    expect(screen.getByRole('link', { name: 'Share it from the puzzle list' })).toHaveAttribute('href', '/puzzles');
    expect(screen.queryByText('No drafts are waiting for review.')).not.toBeInTheDocument();
  });

  it('the final panel builds the not-published sentence from notPublishedReason', async () => {
    serve([drafts[0]!], {
      'POST /api/review/questions/d-1/reject': () =>
        json(200, outcome({
          remainingDrafts: 0,
          task: { id: 't-1', status: 'done', result: 'below_minimum' },
          notPublishedReason: { code: 'below_minimum', approved: 2, minQuestions: 3 },
        })),
    });
    renderWithQuery(<ReviewScreen />);
    await screen.findByRole('region', { name: 'Draft' });
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reject draft' }));
    expect(await screen.findByRole('heading', { name: 'Puzzle not published:' })).toBeInTheDocument();
    expect(screen.getByText('2 of the 3 questions needed were approved.')).toBeInTheDocument();
  });

  it('409 ALREADY_DECIDED shows a notice and refreshes the list', async () => {
    serve(drafts, {
      'POST /api/review/questions/d-1/approve': () => json(409, apiError('ALREADY_DECIDED', 'decided')),
    });
    renderWithQuery(<ReviewScreen />);
    await screen.findByRole('region', { name: 'Draft' });
    const before = calls('GET', '/review/questions').length;
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Someone already decided this draft')).toBeInTheDocument();
    await waitFor(() => expect(calls('GET', '/review/questions').length).toBeGreaterThan(before));
  });

  it('renders no visibility or sharing control', async () => {
    serve();
    renderWithQuery(<ReviewScreen />);
    await screen.findByRole('region', { name: 'Draft' });
    expect(screen.queryByText(/visibility|public|private|share/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows the empty state with a link to the sources', async () => {
    serve([]);
    renderWithQuery(<ReviewScreen />);
    expect(await screen.findByText('No drafts are waiting for review.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your sources' })).toHaveAttribute('href', '/sources');
  });

  it('groups the navigator by source title when no taskId is given', async () => {
    serve([drafts[0]!, draft({ id: 'd-9', taskId: 't-3' })], {});
    renderWithQuery(<ReviewScreen />);
    const nav = await screen.findByRole('navigation', { name: 'Drafts' });
    expect(await within(nav).findByRole('heading', { name: 'Interview notes' })).toBeInTheDocument();
    expect(within(nav).getByRole('heading', { name: 'B-tree drills' })).toBeInTheDocument();
  });

  it('passes the taskId to the list request', async () => {
    serve();
    renderWithQuery(<ReviewScreen taskId="t-1" />);
    await screen.findByRole('region', { name: 'Draft' });
    expect(calls('GET', 'taskId=t-1')).toHaveLength(1);
  });
});
