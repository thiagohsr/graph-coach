import { DAY_MS, QUERY_LIMIT } from '../constants';
import type { CoachDeps, CoachNode } from '../deps';
import type { CoachFlag } from '../flags';
import type { IntroPuzzleRow } from '../rows';
import type { PuzzleChoice, Selection } from '../state';

/**
 * Cold start: the first `intro_puzzles` row and its root concept. Otherwise the first `playable_puzzles_covering` row for
 * the target, falling back to `intro_puzzles`, then to no puzzle. `noContent` when there is neither target nor puzzle.
 */
export function createFindPuzzlesNode(deps: Pick<CoachDeps, 'queries' | 'settings'>): CoachNode {
  return async (state) => {
    const { queries, settings } = deps;
    const recentSince = state.now - settings.recentPlayDays * DAY_MS;
    const userId = state.learnerId;
    const flags: CoachFlag[] = [];

    if ((state.recent?.masteryCount ?? 0) === 0) {
      const [row] = await queries.introPuzzles({ userId, recentSince, limit: QUERY_LIMIT });
      if (!row) return { selection: null, puzzle: null, outcome: 'no_content' };
      const concept = row.rootConcepts[0] ?? row.topConcept;
      const selection: Selection = {
        kind: 'cold_start',
        target: {
          conceptId: concept.conceptId,
          slug: concept.slug,
          name: concept.name,
          score: null,
          attempts: 0,
          lastSeen: null,
          daysSince: null,
          risk: null,
        },
        drivers: [],
        alternatives: [],
      };
      flags.push('cold_start');
      if (row.playedRecently) flags.push('repeat');
      return { selection, puzzle: choiceFromIntro(row, true), flags };
    }

    const selection = state.selection;
    if (!selection) return { puzzle: null, outcome: 'no_content' };

    const [covering] = await queries.playablePuzzlesCovering({
      userId,
      targetIds: [selection.target.conceptId],
      recentSince,
      limit: QUERY_LIMIT,
    });
    if (covering) {
      const coversTarget = covering.coveredTargetIds.includes(selection.target.conceptId);
      if (!coversTarget) flags.push('coverage_gap');
      if (covering.playedRecently) flags.push('repeat');
      const puzzle: PuzzleChoice = {
        puzzleId: covering.puzzleId,
        name: covering.name,
        coversTarget,
        playedRecently: covering.playedRecently,
      };
      return { puzzle, flags };
    }

    const [intro] = await queries.introPuzzles({ userId, recentSince, limit: QUERY_LIMIT });
    flags.push('coverage_gap');
    if (!intro) {
      flags.push('no_puzzle');
      return { puzzle: null, flags };
    }
    if (intro.playedRecently) flags.push('repeat');
    return { puzzle: choiceFromIntro(intro, false), flags };
  };
}

function choiceFromIntro(row: IntroPuzzleRow, coversTarget: boolean): PuzzleChoice {
  return { puzzleId: row.puzzleId, name: row.name, coversTarget, playedRecently: row.playedRecently };
}
