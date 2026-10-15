// name: get_session
// owner: 003
// mode: read
// params: $sessionId (string), $learnerId (string)
// returns: sessionId, puzzleId, puzzleName, puzzleOrigin, startedAt, submittedAt, score, maxScore, answers, masteryChanges
MATCH (l:Learner {id: $learnerId})-[:PLAYED]->(s:Session {id: $sessionId})-[:OF]->(p:Puzzle)
OPTIONAL MATCH (s)-[a:ANSWERED]->(q:Question)<-[r:CONTAINS]-(p)
WITH l, s, p, a, q, r ORDER BY r.order, a.blank
WITH l, s, p,
     collect(CASE WHEN a IS NULL THEN null
                  ELSE {questionId: q.id, order: r.order, blank: a.blank, word: a.word, correct: a.correct} END) AS answers
OPTIONAL MATCH (s)-[m:CHANGED_MASTERY]->(c:Concept)
WITH l, s, p, answers, m, c ORDER BY c.name
WITH l, s, p, answers,
     collect(CASE WHEN m IS NULL THEN null
                  ELSE {conceptId: c.id, name: c.name, before: m.before, after: m.after} END) AS masteryChanges
RETURN s.id AS sessionId, p.id AS puzzleId, p.name AS puzzleName, p.origin AS puzzleOrigin,
       s.startedAt AS startedAt, s.submittedAt AS submittedAt, s.score AS score, s.maxScore AS maxScore,
       answers, masteryChanges
