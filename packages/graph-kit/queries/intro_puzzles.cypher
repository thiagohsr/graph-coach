// name: intro_puzzles
// owner: 004
// mode: read
// params: $userId (string), $recentSince (integer, epoch ms), $limit (integer)
// returns: puzzleId, name, rootConcepts, topConcept, rootCount, conceptCount, lastPlayedAt, playedRecently
// Puzzles the learner can play (canPlay, 002 contracts section 5.3, pasted verbatim), most introductory first: the
// share of tested concepts that are roots (no incoming PREREQUISITE_OF). A puzzle with no root concept is still
// returned, last, with its most tested concept as topConcept. Recently played puzzles sort later.
MATCH (l:Learner {id: $userId})
MATCH (p:Puzzle)-[:CONTAINS]->(q:Question {status: 'approved'})-[:TESTS]->(c:Concept)
WHERE p.status = 'published'
  AND (p.visibility = 'public'
       OR (:Learner {id: $userId})-[:OWNS]->(p)
       OR (p)-[:SHARED_WITH]->(:Learner {id: $userId}))
OPTIONAL MATCH (pre:Concept)-[:PREREQUISITE_OF]->(c)
WITH l, p, c, count(DISTINCT q) AS questions, count(DISTINCT pre) AS prereqCount
ORDER BY questions DESC, c.name ASC, c.slug ASC
WITH l, p, count(c) AS conceptCount,
     collect({conceptId: c.id, slug: c.slug, name: c.name, questions: questions})[0] AS topConcept,
     collect(CASE WHEN prereqCount = 0
                  THEN {conceptId: c.id, slug: c.slug, name: c.name, questions: questions} END) AS rootConcepts
// No WHERE on this OPTIONAL MATCH (see playable_puzzles_covering): max() ignores unsubmitted sessions.
OPTIONAL MATCH (l)-[:PLAYED]->(s:Session)-[:OF]->(p)
WITH p, conceptCount, topConcept, rootConcepts, max(s.submittedAt) AS lastPlayedAt
WITH p, conceptCount, topConcept, rootConcepts, lastPlayedAt,
     CASE WHEN lastPlayedAt IS NOT NULL AND lastPlayedAt >= $recentSince THEN 1 ELSE 0 END AS recentFlag
RETURN p.id AS puzzleId, p.name AS name, rootConcepts, topConcept,
       size(rootConcepts) AS rootCount, conceptCount, lastPlayedAt,
       recentFlag = 1 AS playedRecently
ORDER BY recentFlag ASC,
         toFloat(size(rootConcepts)) / conceptCount DESC, size(rootConcepts) DESC, name ASC, puzzleId ASC
LIMIT $limit
