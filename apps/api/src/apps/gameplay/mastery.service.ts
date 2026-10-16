import { Inject, Injectable, Logger } from '@nestjs/common';
import { toIso, GraphKit } from '@coach/graph-kit';
import type { MasteryDto } from '@coach/types';
import { CLOCK, type Clock } from '../../common/clock';
import { SettingsService } from '../../common/settings/settings.service';
import type { AnswerKey, GradedBlank, MasteryChange } from './gameplay.dto';
import { MasteryRow } from './gameplay.queries';
import { foldMastery } from './mastery';

@Injectable()
export class MasteryService {
  private readonly logger = new Logger('MasteryService');

  constructor(
    @Inject(GraphKit) private readonly graph: GraphKit,
    @Inject(SettingsService) private readonly settings: Pick<SettingsService, 'get'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Reads current mastery for the touched concepts and computes the changes. No writes. */
  async plan(learnerId: string, blanks: GradedBlank[], key: AnswerKey): Promise<MasteryChange[]> {
    const conceptsOf = new Map(key.map((entry) => [entry.questionId, entry.concepts]));
    const outcomes = new Map<string, { name: string; outcomes: (0 | 1)[] }>();
    const skipped = new Set<string>();
    // Fold order: question order ascending, then blank index (blanks arrive sorted that way; sort again to be safe).
    const ordered = [...blanks].sort((a, b) => a.order - b.order || a.blank - b.blank);
    for (const blank of ordered) {
      const concepts = conceptsOf.get(blank.questionId) ?? [];
      if (concepts.length === 0) {
        if (!skipped.has(blank.questionId)) {
          skipped.add(blank.questionId);
          this.logger.warn(`mastery_skipped_no_concept question=${blank.questionId}`);
        }
        continue;
      }
      for (const concept of concepts) {
        const entry = outcomes.get(concept.id) ?? { name: concept.name, outcomes: [] };
        entry.outcomes.push(blank.correct ? 1 : 0);
        outcomes.set(concept.id, entry);
      }
    }
    if (outcomes.size === 0) return [];

    const conceptIds = [...outcomes.keys()];
    const current = await this.graph.query(
      'learner_mastery',
      { learnerId, conceptIds },
      { schema: MasteryRow },
    );
    const previous = new Map(
      current.map((row) => [row.conceptId, { score: row.score, attempts: row.attempts }]),
    );
    const alpha = await this.settings.get('masteryAlpha');

    return conceptIds
      .map((conceptId) => {
        const entry = outcomes.get(conceptId)!;
        return {
          conceptId,
          name: entry.name,
          ...foldMastery(previous.get(conceptId), entry.outcomes, alpha),
        };
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /**
   * plan() + upsert_mastery. For seed tooling and tests ONLY: it must not be called from a controller or from submit
   * (submit writes mastery inside record_answers, in one query).
   */
  async apply(
    learnerId: string,
    blanks: GradedBlank[],
    key: AnswerKey,
    now?: number,
  ): Promise<MasteryChange[]> {
    const changes = await this.plan(learnerId, blanks, key);
    if (changes.length === 0) return changes;
    const lastSeen = now ?? this.clock.now().getTime();
    await this.graph.query('upsert_mastery', {
      learnerId,
      rows: changes.map((c) => ({
        conceptId: c.conceptId,
        score: c.after,
        attempts: c.attempts,
        lastSeen,
      })),
    });
    return changes;
  }

  /** Every practised concept, ordered by name. */
  async list(learnerId: string): Promise<MasteryDto[]> {
    const rows = await this.graph.query(
      'learner_mastery',
      { learnerId, conceptIds: null },
      { schema: MasteryRow },
    );
    return rows
      .map((row) => ({
        conceptId: row.conceptId,
        name: row.name,
        score: row.score,
        attempts: row.attempts,
        lastSeen: toIso(row.lastSeen),
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
}
