// name: concept_answer_evidence
// owner: 004
// mode: read
// params: $learnerId (string), $conceptIds (list of strings), $limit (integer)
// returns: conceptId, questionId, sessionId, submittedAt, misses
// The learner's wrong answers on questions that test the given concepts, in submitted sessions only. One row per
// concept, question, and session; misses counts the wrong blanks. Never selects answers, distractors, or submitted words.
MATCH (l:Learner {id: $learnerId})-[:PLAYED]->(s:Session)-[a:ANSWERED]->(q:Question)-[:TESTS]->(c:Concept)
WHERE c.id IN $conceptIds AND a.correct = false AND s.submittedAt IS NOT NULL
RETURN c.id AS conceptId, q.id AS questionId, s.id AS sessionId,
       s.submittedAt AS submittedAt, count(a) AS misses
ORDER BY submittedAt DESC, questionId ASC, conceptId ASC
LIMIT $limit
