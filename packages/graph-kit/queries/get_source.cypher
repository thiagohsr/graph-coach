// name: get_source
// owner: 005
// mode: read
// params: $sourceId (string), $userId (string)
// returns: id, title, kind, createdAt, content, brief, access, ownerName, puzzleId
// The only query that returns a source's text or brief. canReadSource fragment, verbatim from 002's access helpers
// (as in list_sources): the caller owns the source, or the puzzle it yielded is shared with the caller with
// withSource = true. No role sees more, and a public puzzle does not open its source. No row = 404.
MATCH (owner:Learner)-[:OWNS]->(s:Source {id: $sourceId})
WHERE ((:Learner {id: $userId})-[:OWNS]->(s)
       OR (s)-[:YIELDED]->(:Puzzle)-[:SHARED_WITH {withSource: true}]->(:Learner {id: $userId}))
OPTIONAL MATCH (s)-[:YIELDED]->(p:Puzzle)
RETURN s.id AS id, s.title AS title, s.kind AS kind, s.createdAt AS createdAt,
       s.content AS content, s.brief AS brief,
       CASE WHEN owner.id = $userId THEN 'owner' ELSE 'shared' END AS access,
       owner.displayName AS ownerName, p.id AS puzzleId
LIMIT 1
