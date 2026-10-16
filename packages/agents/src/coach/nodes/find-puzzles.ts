import { ANSWER_ROWS_LIMIT, DAY_MS, QUERY_LIMIT } from '../constants';
import type { CoachDeps, CoachNode } from '../deps';
import type { CoachFlag } from '@coach/types';
import { goalSelection } from '../goal';
import type { IntroPuzzleRow } from '../rows';
import type { PuzzleChoice, Selection } from '../state';

/**
 * Cold start: the first `intro_puzzles` row and its root concept. Otherwise the first `playable_puzzles_covering` row for
 * the target, falling back to `intro_puzzles`, then to no puzzle. `noContent` when there is neither target nor puzzle.
 * With a goal, a second `playable_puzzles_covering` call over the goal's concepts yields `missingConceptIds` (stretch).
 */
export function createFindPuzzlesNode(deps: Pick<CoachDeps, 'queries' | 'settings'>): CoachNode {
  return async (state) => {
    const { queries, settings } = deps;
    const recentSince = state.now - settings.recentPlayDays * DAY_MS;
    const userId = state.learnerId;
    const flags: CoachFlag[] = [];

    const missing = async (): Promise<string[]> => {
      const targetIds = state.goal?.targetIds ?? [];
      if (targetIds.length === 0) return [];
      const rows = await queries.playablePuzzlesCovering({ userId, targetIds, recentSince, limit: ANSWER_ROWS_LIMIT });
      const covered = new Set(rows.flatMap((row) => row.coveredTargetIds));
      return targetIds.filter((id) => !covered.has(id));
    };

    if ((state.recent?.masteryCount ?? 0) === 0) {
      const [row] = await queries.introPuzzles({ userId, recentSince, limit: QUERY_LIMIT });
      if (!row) {
        // A goal about content that does not exist yet still gets a target, so a coverage request can follow.
        const fallback = goalSelection(state.goal);
        if (!fallback) return { selection: null, puzzle: null, outcome: 'no_content' };
        flags.push('coverage_gap', 'no_puzzle');
        return { selection: fallback, puzzle: null, flags, missingConceptIds: await missing() };
      }
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
      return { selection, puzzle: choiceFromIntro(row, true), flags, missingConceptIds: await missing() };
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
      return { puzzle, flags, missingConceptIds: await missing() };
    }

    const [intro] = await queries.introPuzzles({ userId, recentSince, limit: QUERY_LIMIT });
    flags.push('coverage_gap');
    if (!intro) {
      flags.push('no_puzzle');
      return { puzzle: null, flags, missingConceptIds: await missing() };
    }
    if (intro.playedRecently) flags.push('repeat');
    return { puzzle: choiceFromIntro(intro, false), flags, missingConceptIds: await missing() };
  };
}

function choiceFromIntro(row: IntroPuzzleRow, coversTarget: boolean): PuzzleChoice {
  return { puzzleId: row.puzzleId, name: row.name, coversTarget, playedRecently: row.playedRecently };
}
