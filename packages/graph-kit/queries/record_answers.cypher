// name: record_answers
// owner: 003
// mode: write
// params: $sessionId (string), $learnerId (string), $answers (list of {questionId, blank, word, correct}), $mastery (list of {conceptId, before, after, attempts}), $score (integer), $maxScore (integer), $now (integer)
// returns: sessionId, answersWritten, conceptsUpdated
// The single submit write (reconciliation D2). Atomic on the pinned FalkorDB (a later-clause error rolls everything
// back, spike S10). Clause order: mastery, answers, submittedAt last. MERGE + SET everywhere so a retry is safe.
MATCH (l:Learner {id: $learnerId})-[:PLAYED]->(s:Session {id: $sessionId})
WHERE s.submittedAt IS NULL
WITH l, s
UNWIND (CASE WHEN size($mastery) = 0 THEN [null] ELSE $mastery END) AS m
OPTIONAL MATCH (c:Concept {id: m.conceptId})
FOREACH (ignored IN CASE WHEN c IS NULL THEN [] ELSE [1] END |
  MERGE (s)-[d:CHANGED_MASTERY]->(c)
  SET d.before = m.before, d.after = m.after
  MERGE (l)-[h:HAS_MASTERY]->(c)
  SET h.score = m.after, h.attempts = m.attempts, h.lastSeen = $now
)
WITH l, s, count(c) AS conceptsUpdated
UNWIND $answers AS a
MATCH (s)-[:OF]->(:Puzzle)-[:CONTAINS]->(q:Question {id: a.questionId})
MERGE (s)-[r:ANSWERED {blank: a.blank}]->(q)
SET r.word = a.word, r.correct = a.correct
WITH s, conceptsUpdated, count(r) AS answersWritten
SET s.score = $score, s.maxScore = $maxScore, s.submittedAt = $now
RETURN s.id AS sessionId, answersWritten, conceptsUpdated
