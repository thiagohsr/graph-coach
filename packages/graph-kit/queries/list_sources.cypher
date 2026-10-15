// name: list_sources
// owner: 005
// mode: read
// params: $userId (string)
// returns: id, title, kind, createdAt, access, ownerName, chunkCount, conceptCount, puzzleId, taskId, taskStatus
// The sources the caller owns or was given (canReadSource fragment, verbatim from 002's access helpers). No role sees
// more. Never returns `content` or `brief`. taskId and taskStatus are null for a shared source. Counted in stages
// (one WITH per count) because FalkorDB returns null for an expression that mixes a grouping key with an aggregate.
MATCH (owner:Learner)-[:OWNS]->(s:Source)
WHERE ((:Learner {id: $userId})-[:OWNS]->(s)
       OR (s)-[:YIELDED]->(:Puzzle)-[:SHARED_WITH {withSource: true}]->(:Learner {id: $userId}))
OPTIONAL MATCH (s)-[:HAS_CHUNK]->(ch:Chunk)
WITH owner, s, count(DISTINCT ch) AS chunkCount
OPTIONAL MATCH (s)-[:HAS_CHUNK]->(:Chunk)-[:MENTIONS]->(c:Concept)
WITH owner, s, chunkCount, count(DISTINCT c) AS mentioned
OPTIONAL MATCH (gq:Question)-[:GENERATED_FROM]->(s)
OPTIONAL MATCH (gq)-[:TESTS]->(gc:Concept)
WITH owner, s, chunkCount, mentioned, count(DISTINCT gc) AS tested
WITH owner, s, chunkCount, mentioned + tested AS conceptCount
OPTIONAL MATCH (s)-[:YIELDED]->(p:Puzzle)
WITH owner, s, chunkCount, conceptCount, p
OPTIONAL MATCH (t:Task)-[:CONCERNS]->(s)
WHERE t.kind IN ['ingest', 'generate']
RETURN s.id AS id, s.title AS title, s.kind AS kind, s.createdAt AS createdAt,
       CASE WHEN owner.id = $userId THEN 'owner' ELSE 'shared' END AS access,
       owner.displayName AS ownerName, chunkCount, conceptCount, p.id AS puzzleId,
       CASE WHEN owner.id = $userId THEN t.id ELSE null END AS taskId,
       CASE WHEN owner.id = $userId THEN t.status ELSE null END AS taskStatus
ORDER BY createdAt DESC
