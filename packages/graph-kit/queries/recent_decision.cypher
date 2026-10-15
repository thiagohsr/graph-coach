// name: recent_decision
// owner: 004
// mode: read
// params: $learnerId (string), $since (integer, epoch ms: now minus coachReuseMinutes)
// returns: masteryCount, decisionId, createdAt, newAnswers, goalText
// Always one row for an existing learner (zero rows: the Learner node is missing). decisionId is null when the learner
// has no decision inside the window. newAnswers: a session was submitted after that decision.
// A WHERE on an OPTIONAL MATCH that follows an aggregating WITH makes the pinned FalkorDB drop every match (spike,
// 004 research), so the window test is a CASE and the session comparison sits inside count(CASE ...).
MATCH (l:Learner {id: $learnerId})
OPTIONAL MATCH (l)-[m:HAS_MASTERY]->(:Concept)
WITH l, count(m) AS masteryCount
OPTIONAL MATCH (d:Decision)-[:FOR]->(l)
WITH l, masteryCount, CASE WHEN d.createdAt >= $since THEN d END AS recent
ORDER BY coalesce(recent.createdAt, -1) DESC
LIMIT 1
OPTIONAL MATCH (l)-[:PLAYED]->(s:Session)
WITH masteryCount, recent,
     count(CASE WHEN recent IS NOT NULL AND s.submittedAt > recent.createdAt THEN 1 END) AS newSessions
OPTIONAL MATCH (recent)-[:TOWARD]->(g:Goal)
RETURN masteryCount,
       recent.id AS decisionId,
       recent.createdAt AS createdAt,
       newSessions > 0 AS newAnswers,
       g.text AS goalText
