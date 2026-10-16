// Synthetic test data for the Curator: two sample texts and scripted stub responses for the three structured-output
// labels. The text is invented (a made-up tour of library cataloguing); nothing here comes from a real source.
import type { StubCall, StubChatProvider, StubResponse } from '../../llm/stub';

export interface Topic {
  keyword: string;
  slug: string;
  name: string;
  description: string;
  sentences: string[];
}

export const TOPICS: Topic[] = [
  {
    keyword: 'call number',
    slug: 'call-numbers',
    name: 'Call numbers',
    description: 'Short codes on a spine that say where a book belongs on the shelves.',
    sentences: [
      'A call number is the short code printed on the spine of a book, and it tells a reader exactly where the book belongs on the shelves.',
      'Librarians build each code from a class letter, a few digits, and a short mark for the author, so two different books almost never share one.',
      'Because the shelves follow the codes in strict order, a visitor who holds a slip of paper can walk straight to the right bay without asking anyone.',
      'When a book is returned, a trolley team reads the code on the spine and slides the volume back into the gap that was left when it was borrowed.',
      'A wrong digit on a label can hide a book for years, which is why the cataloguers check every new label against the record before it is stuck down.',
      'Some small branches keep fiction in plain alphabetical order and use the full code only for reference works that must never wander between rooms.',
      'The codes for a series usually differ by one final number, so the volumes of an encyclopedia stand side by side and can be read in sequence.',
      'Large university libraries print a second code on the end of the spine, because tall books are shelved in a separate row to save space.',
      'Visitors learn the pattern quickly, and after a week most regular readers can guess the neighbourhood of a topic before they open the catalogue.',
      'Teachers sometimes set a treasure hunt that sends pupils to three codes in a row, and the game teaches the shelving logic better than a lecture.',
      'The oldest codes in the building were written by hand, and the staff still keep a chart that explains the faded letters used by earlier generations.',
      'A volunteer once spent a whole winter relabelling the travel section, and the circulation figures for those shelves rose by a third the following spring.',
      'If a book is moved to a new room, the label is replaced and the old record is closed, so that the catalogue never points at an empty shelf.',
      'Every year the team walks the stacks with a handheld scanner and compares each label with the catalogue to find books that have drifted out of place.',
    ],
  },
  {
    keyword: 'accession register',
    slug: 'accession-register',
    name: 'Accession register',
    description: 'The ledger in which every new item is recorded on the day it arrives.',
    sentences: [
      'The accession register is the ledger in which every new item is written down on the day it arrives, long before it reaches a shelf.',
      'Each line holds a running number, the date, the supplier, the price, and a short note about the condition of the item at the door.',
      'Because the numbers only ever increase, the accession register works like a diary of the collection and shows exactly how fast it has grown.',
      'Auditors ask for the ledger first, since it proves that a missing volume was once owned and lets them trace what happened to it afterwards.',
      'Gifts are entered in the same way as purchases, with the donor named in the margin so that a thank you letter can be sent without delay.',
      'When an item is withdrawn, the clerk strikes a single line through the entry and adds the reason, but never erases the original ink.',
      'Digital copies of the pages are stored in a fireproof room, and a second set is kept in another town in case of flood.',
      'A newcomer to the desk is first taught to write the numbers clearly, because a smudged digit can cost an afternoon of searching later.',
      'Rare items receive a second stamp inside the cover that repeats the running number, so a book without its jacket can still be identified.',
      'The clerk who keeps the ledger also keeps the receipts, and the two piles are checked against each other at the end of every month.',
      'Over the decades the ledger has grown to forty volumes, and the early ones are now consulted mostly by historians of the town.',
      'Some libraries have replaced the paper book with a database, but they still print the first page of each year and sign it by hand.',
      'The running numbers never restart, so the total at the bottom of the last page is also the number of items the library has ever received.',
      'A visiting student once found her grandfather’s donation recorded in the oldest volume, and the staff framed a copy of the page for her.',
    ],
  },
  {
    keyword: 'subject heading',
    slug: 'subject-headings',
    name: 'Subject headings',
    description:
      'Agreed phrases that describe what a book is about so readers can find it by topic.',
    sentences: [
      'A subject heading is an agreed phrase that describes what a book is about, so that readers can find it by topic rather than by title.',
      'Two books with very different titles can carry the same subject heading, and a single search then brings both of them to the screen.',
      'Cataloguers choose the phrase from an authorised list, which keeps the wording steady even when many people add records over many years.',
      'Without a shared list, one person would write boats, another would write ships, and a reader would see only half of the collection.',
      'The list also records which phrases to avoid, and it points the reader from the unused word to the one that the library has chosen.',
      'A thick book may receive several headings, one for each major theme, while a slim pamphlet usually needs only a single phrase.',
      'Headings can be narrowed with a second phrase after a dash, such as a place or a period, to separate the large from the small.',
      'When language changes, the committee revises a phrase, and the system updates every affected record so that old and new searches still agree.',
      'Children’s collections use simpler phrases, and a gentle word such as animals may stand in place of a long scientific term.',
      'Readers who browse the shelves rarely notice the headings, yet the same phrases decide which books sit together in the display cases.',
      'A good heading is specific without being strange, and cataloguers practise by describing a book in five words before they look at the list.',
      'Online catalogues show the phrases as clickable links, and a curious reader can wander from one book to the next for an entire evening.',
      'Mistakes are corrected in batches, because a single wrong phrase repeated across hundreds of records would otherwise hide a whole topic.',
      'New staff are told that every heading is a promise to the reader, and that a vague promise is worse than none at all.',
    ],
  },
  {
    keyword: 'interlibrary loan',
    slug: 'interlibrary-loan',
    name: 'Interlibrary loan',
    description: 'A service that borrows items from other libraries for a reader.',
    sentences: [
      'An interlibrary loan lets a reader borrow a book that the local library does not own by asking another library to send it.',
      'The request travels through a shared network, and within a minute the staff can see which nearby libraries hold a copy on their shelves.',
      'Most items arrive in a few days in a sealed bag, and the reader receives a message as soon as the parcel is on the holds shelf.',
      'The borrowing library pays the postage in one direction, and the reader pays a small fee or nothing at all, depending on local rules.',
      'Rare and fragile books are rarely sent away, but the lending library may offer a scan of the pages that the reader needs.',
      'Because the book belongs to a stranger, the loan period is short, and the reader is reminded of the date by a printed slip.',
      'A well-run interlibrary loan desk keeps a list of partners that answer quickly, and it learns over time which ones are slow in winter.',
      'Researchers depend on the service, since a single thesis can need thirty obscure titles that no one town could ever afford to buy.',
      'Staff check every incoming parcel against the request, then stamp the book and slide a paper band around it with the due date.',
      'When the book comes back, the band is removed, the condition is noted, and the parcel is sent home on the same afternoon.',
      'Libraries in remote regions use the service more than any others, because their own shelves are small and the nearest city is far away.',
      'Fees are kept low on purpose, since the goal is to widen the collection of every member rather than to earn money from the traffic.',
      'Disputes are rare, but a lost book is usually settled by a replacement copy, a payment, or a quiet exchange between the two directors.',
      'The oldest requests on file were typed on cards, and the desk still keeps one in a frame as a reminder of how slow the service once was.',
    ],
  },
];

function paragraphs(count: number): string[] {
  return TOPICS.slice(0, count).map((topic) => topic.sentences.join(' '));
}

/** About 300 words, plain text, two topics. */
export const SHORT_TEXT: string = TOPICS.slice(0, 2)
  .map((topic) => topic.sentences.slice(0, 6).join(' '))
  .join('\n\n');

/** About 1,000 words, plain text, four topics. */
export const LONG_TEXT: string = TOPICS.map((topic) => topic.sentences.slice(0, 11).join(' ')).join(
  '\n\n',
);

/** The same material as Markdown: headings, a list, and emphasis. */
export const LONG_MARKDOWN: string = [
  '# A tour of library cataloguing',
  '',
  ...TOPICS.flatMap((topic) => [
    `## ${topic.name}`,
    '',
    topic.sentences.slice(0, 11).join(' '),
    '',
  ]),
  '- *Call numbers* place a book',
  '- **Subject headings** describe a book',
].join('\n');

/** Every sentence of every topic, for tests that need a very long text. */
export const FULL_TEXT: string = paragraphs(TOPICS.length).join('\n\n');

// ─── Scripted stub responses ─────────────────────────────────────────────────

export const CURATOR_LABELS = {
  extract: 'curator.extractConcepts',
  link: 'curator.linkPrerequisites',
  draft: 'curator.draftQuestions',
} as const;

export type DraftMode = 'valid' | 'rule-breaking' | 'schema-invalid';

/** The user message of a call, which holds the delimited data. */
function userMessage(call: StubCall): string {
  return call.messages.find((m) => m.role === 'user')?.content ?? '';
}

/** The passage between the per-call delimiters. */
export function passageOf(call: StubCall): string {
  const match = /<<<PASSAGE:(\w+)>>>\n([\s\S]*?)\n<<<END:\1>>>/.exec(userMessage(call));
  return match?.[2] ?? '';
}

/** The concept lines of a prompt, in order: `slug | name | description`. */
export function conceptLinesOf(call: StubCall): Array<{ slug: string; name: string }> {
  const out: Array<{ slug: string; name: string }> = [];
  for (const match of userMessage(call).matchAll(
    /<<<CONCEPT:(\w+)>>>\n([\s\S]*?)\n<<<END:\1>>>/g,
  )) {
    const [slug, name] = (match[2] ?? '').split(' | ');
    if (slug && name) out.push({ slug: slug.trim(), name: name.trim() });
  }
  return out;
}

const countOccurrences = (haystack: string, needle: string) =>
  haystack.toLowerCase().split(needle.toLowerCase()).length - 1;

/** The topics whose keyword occurs in the passage. */
export function topicsIn(passage: string): Topic[] {
  return TOPICS.filter((topic) => countOccurrences(passage, topic.keyword) > 0);
}

export function extractedConceptsFor(call: StubCall) {
  return {
    concepts: topicsIn(passageOf(call)).map((topic) => ({
      name: topic.name,
      description: topic.description,
      existingSlug: null,
    })),
  };
}

/** A well-formed draft from the first sentence that contains a topic keyword exactly once. */
export function draftsFor(call: StubCall, mode: DraftMode = 'valid') {
  if (mode === 'schema-invalid') return { questions: 'not a list' };
  const passage = passageOf(call);
  const concepts = conceptLinesOf(call);
  const questions: Array<{
    sentence: string;
    answers: string[];
    distractors: string[];
    conceptSlugs: string[];
  }> = [];
  for (const topic of topicsIn(passage)) {
    const slug = concepts.find((c) => c.name === topic.name)?.slug ?? topic.slug;
    const sentence = topic.sentences.find(
      (s) => countOccurrences(s, topic.keyword) === 1 && passage.includes(s),
    );
    if (!sentence) continue;
    const at = sentence.toLowerCase().indexOf(topic.keyword);
    const answer = sentence.slice(at, at + topic.keyword.length);
    const blanked = `${sentence.slice(0, at)}___${sentence.slice(at + topic.keyword.length)}`;
    questions.push({
      sentence: blanked,
      answers: mode === 'rule-breaking' ? [answer, 'extra answer'] : [answer],
      distractors: ['catalogue card', 'shelf trolley'],
      conceptSlugs: [slug],
    });
  }
  return { questions: questions.slice(0, 3) };
}

/** Prerequisite links as a chain through the concepts listed in the prompt. */
export function chainLinksFor(call: StubCall) {
  const concepts = conceptLinesOf(call);
  return {
    links: concepts.slice(0, -1).map((c, i) => ({
      prerequisite: c.slug,
      dependent: concepts[i + 1]!.slug,
      confidence: 0.8,
    })),
  };
}

// ─── Scripted stub responses: the prompt graph (planner, writer, critic) ───────

export const PROMPT_LABELS = {
  outline: 'curator.prompt.outline',
  write: 'curator.prompt.write',
  critique: 'curator.prompt.critique',
  rewrite: 'curator.prompt.rewrite',
  recritique: 'curator.prompt.recritique',
  topup: 'curator.prompt.topup',
} as const;

export type PromptVerdict = 'pass' | 'rewrite' | 'reject';

/** The longest word of a fact that occurs once in it: what a stub writer blanks. */
export function answerOf(fact: string): string {
  const words = fact.match(/[A-Za-z]{6,}/g) ?? [];
  const once = words.filter((w) => countOccurrences(fact, w) === 1);
  return once.reduce(
    (best, w) => (w.length > best.length ? w : best),
    once[0] ?? words[0] ?? 'books',
  );
}

/** Sentences of the first two topics, alternating: the planner's facts. */
function factPool(): Array<{ topic: Topic; fact: string }> {
  const columns = TOPICS.slice(0, 2).map((topic) =>
    topic.sentences.filter((s) => answerOf(s) !== '').map((fact) => ({ topic, fact })),
  );
  const out: Array<{ topic: Topic; fact: string }> = [];
  for (let i = 0; i < Math.max(...columns.map((c) => c.length)); i += 1) {
    for (const column of columns) if (column[i]) out.push(column[i]!);
  }
  return out;
}

/** "Plan exactly N sentences." in a planner prompt. */
export function plannedCountOf(call: StubCall): number {
  return Number(/Plan exactly (\d+) sentences/.exec(userMessage(call))?.[1] ?? 0);
}

/** The planned facts of a writer or rewrite prompt: `index | concept slug | fact`. */
export function plannedFactsOf(
  call: StubCall,
): Array<{ index: number; slug: string; fact: string }> {
  const out: Array<{ index: number; slug: string; fact: string }> = [];
  for (const match of userMessage(call).matchAll(/<<<FACT:(\w+)>>>\n([\s\S]*?)\n<<<END:\1>>>/g)) {
    const [index, slug, ...rest] = (match[2] ?? '').split(' | ');
    out.push({ index: Number(index), slug: (slug ?? '').trim(), fact: rest.join(' | ') });
  }
  return out;
}

/** The draft indexes of a critic prompt. */
export function draftIndexesOf(call: StubCall): number[] {
  return [...userMessage(call).matchAll(/<<<DRAFT:(\w+)>>>\nindex: (\d+)\n/g)].map((m) =>
    Number(m[2]),
  );
}

/** What the planner returns for a prompt that asks for `plan` sentences. */
export function outlineFor(call: StubCall) {
  const pool = factPool();
  const plan = Math.max(3, Math.min(12, plannedCountOf(call)));
  const [first, second] = TOPICS;
  return {
    concepts: [first!, second!].map((t) => ({ name: t.name, description: t.description })),
    sentences: Array.from({ length: plan }, (_, i) => ({
      fact: pool[i % pool.length]!.fact,
      concept: pool[i % pool.length]!.topic.name,
    })),
    criteria: ['Every sentence stays at the level of everyday library work.'],
    prerequisites: [{ prerequisite: first!.name, dependent: second!.name, confidence: 0.8 }],
  };
}

/** A well-formed draft for each planned fact: the topic keyword is blanked. */
export function promptDraftsFor(call: StubCall) {
  return {
    drafts: plannedFactsOf(call).map(({ index, slug, fact }) => {
      const answer = answerOf(fact);
      const at = fact.indexOf(answer);
      return {
        index,
        sentence: `${fact.slice(0, at)}___${fact.slice(at + answer.length)}`,
        answers: [answer],
        distractors: ['catalogue card', 'shelf trolley'],
        conceptSlug: slug,
      };
    }),
  };
}

/**
 * A well-formed draft for each slot of a top-up prompt. A slot with a planned fact states it; a NEW slot gets a fact from a
 * third or fourth topic (never one of the planned facts), so it cannot repeat a planned sentence.
 */
export function topUpDraftsFor(call: StubCall) {
  const spare = TOPICS.slice(2).flatMap((topic) =>
    topic.sentences.filter((s) => answerOf(s) !== ''),
  );
  return {
    drafts: plannedFactsOf(call).map(({ index, slug, fact }) => {
      const text = fact === 'NEW' ? spare[index % spare.length]! : fact;
      const answer = answerOf(text);
      const at = text.indexOf(answer);
      return {
        index,
        sentence: `${text.slice(0, at)}___${text.slice(at + answer.length)}`,
        answers: [answer],
        distractors: ['catalogue card', 'shelf trolley'],
        conceptSlug: slug,
      };
    }),
  };
}

/** One review per draft sent. `verdicts` maps a draft index to its verdict; everything else passes. */
export function critiquesFor(call: StubCall, verdicts: Record<number, PromptVerdict> = {}) {
  return {
    reviews: draftIndexesOf(call).map((index) => {
      const verdict = verdicts[index] ?? 'pass';
      return {
        index,
        verdict,
        note: verdict === 'pass' ? 'Clear and checkable.' : 'The wording needs work.',
        failed: verdict === 'pass' ? [] : ['one_answer'],
      };
    }),
  };
}

/**
 * Registers the five prompt labels with well-formed answers. `firstVerdicts` is what the critic says about the first
 * pass, `secondVerdicts` what it says about the rewrites (default: everything passes).
 */
export function scriptPrompt(
  chat: StubChatProvider,
  options: {
    firstVerdicts?: Record<number, PromptVerdict>;
    secondVerdicts?: Record<number, PromptVerdict>;
    /** The top-up writer; by default the label is not scripted, so a run that tops up without meaning to fails loudly. */
    topUp?: StubResponse;
    /** Replaces the first-pass writer. */
    write?: StubResponse;
  } = {},
): StubChatProvider {
  chat.on(PROMPT_LABELS.outline, (call) => outlineFor(call));
  chat.on(PROMPT_LABELS.write, options.write ?? ((call) => promptDraftsFor(call)));
  chat.on(PROMPT_LABELS.critique, (call) => critiquesFor(call, options.firstVerdicts));
  chat.on(PROMPT_LABELS.rewrite, (call) => promptDraftsFor(call));
  chat.on(PROMPT_LABELS.recritique, (call) => critiquesFor(call, options.secondVerdicts));
  if (options.topUp) chat.on(PROMPT_LABELS.topup, options.topUp);
  return chat;
}

/** Registers the three labels with well-formed answers; `drafts` picks the kind of draft the writer returns. */
export function scriptCurator(
  chat: StubChatProvider,
  options: { drafts?: DraftMode } = {},
): StubChatProvider {
  chat.on(CURATOR_LABELS.extract, (call) => extractedConceptsFor(call));
  chat.on(CURATOR_LABELS.link, (call) => chainLinksFor(call));
  chat.on(CURATOR_LABELS.draft, (call) => draftsFor(call, options.drafts ?? 'valid'));
  return chat;
}
