// name: question_grounding
// owner: 003
// mode: read
// params: $sessionId (string), $userId (string)
// returns: questionId, chunkId, sourceId, text
// One row per answered question with a passage the caller may read (canReadSource, 002 fragment, verbatim).
// Nothing for an unsubmitted session or another learner's session. No canPlay clause: a revoked share only
// removes the passage, never the result. Prompt-made questions have GENERATED_FROM, not GROUNDED_IN: no row (J3).
MATCH (:Learner {id: $userId})-[:PLAYED]->(sess:Session {id: $sessionId})
WHERE sess.submittedAt IS NOT NULL
MATCH (sess)-[:ANSWERED]->(q:Question)-[:GROUNDED_IN]->(ch:Chunk)
MATCH (s:Source)-[:HAS_CHUNK]->(ch)
// canReadSource fragment (002 contracts §5.3), verbatim
WHERE ((:Learner {id: $userId})-[:OWNS]->(s)
       OR (s)-[:YIELDED]->(:Puzzle)-[:SHARED_WITH {withSource: true}]->(:Learner {id: $userId}))
WITH DISTINCT q, ch, s ORDER BY ch.position
WITH q, collect({chunkId: ch.id, sourceId: s.id, text: ch.text})[0] AS first
RETURN q.id AS questionId, first.chunkId AS chunkId, first.sourceId AS sourceId, first.text AS text
ORDER BY questionId
