// name: playable_puzzles_covering
// owner: 004
// mode: read
// params: $userId (string), $targetIds (list of strings), $recentSince (integer, epoch ms), $limit (integer)
// returns: puzzleId, name, overlap, coveredTargetIds, targetQuestions, lastPlayedAt, playedRecently
// Puzzles the learner can play (canPlay, 002 contracts section 5.3, pasted verbatim) with an approved question on a
// target or on a neighbour (one PREREQUISITE_OF hop in either direction). Covering the target first, then not played
// since $recentSince, then overlap, then number of target questions, then name and id.
MATCH (l:Learner {id: $userId})
MATCH (t:Concept) WHERE t.id IN $targetIds
OPTIONAL MATCH (t)-[:PREREQUISITE_OF]-(n:Concept)
WITH l, collect(DISTINCT t.id) AS tIds, collect(DISTINCT n.id) AS nIds
MATCH (p:Puzzle)-[:CONTAINS]->(q:Question {status: 'approved'})-[:TESTS]->(c:Concept)
WHERE (c.id IN tIds OR c.id IN nIds)
  AND p.status = 'published'
  AND (p.visibility = 'public'
       OR (:Learner {id: $userId})-[:OWNS]->(p)
       OR (p)-[:SHARED_WITH]->(:Learner {id: $userId}))
WITH l, p, tIds,
     collect(DISTINCT c.id) AS coveredIds,
     count(DISTINCT CASE WHEN c.id IN tIds THEN q.id END) AS targetQuestions
// No WHERE on this OPTIONAL MATCH: after an aggregating WITH it makes the pinned FalkorDB drop every match. max() ignores
// the null submittedAt of an unsubmitted session, which is the filter.
OPTIONAL MATCH (l)-[:PLAYED]->(s:Session)-[:OF]->(p)
WITH p, tIds, coveredIds, targetQuestions, max(s.submittedAt) AS lastPlayedAt
WITH p, coveredIds, targetQuestions, lastPlayedAt,
     [id IN coveredIds WHERE id IN tIds] AS coveredTargetIds,
     CASE WHEN lastPlayedAt IS NOT NULL AND lastPlayedAt >= $recentSince THEN 1 ELSE 0 END AS recentFlag
RETURN p.id AS puzzleId, p.name AS name,
       size(coveredIds) AS overlap,
       coveredTargetIds, targetQuestions, lastPlayedAt,
       recentFlag = 1 AS playedRecently
ORDER BY CASE WHEN size(coveredTargetIds) > 0 THEN 0 ELSE 1 END ASC,
         recentFlag ASC, overlap DESC, targetQuestions DESC, name ASC, puzzleId ASC
LIMIT $limit
