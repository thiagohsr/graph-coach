// name: resolve_goal_concepts
// owner: 004
// mode: read
// params: $userId (string, the learner), $embedding (list of floats), $k (integer), $minSimilarity (number 0..1), $goalText (string, lower-cased, whitespace collapsed), $goalSlugText (string, the same text with spaces as hyphens), $limit (integer)
// returns: conceptId, slug, name, score, bestChunkId (null for a name match), via ('passage' | 'name')
// Two sources of matches. (1) Vector search over chunks, kept only when the learner passes canReadSource on the chunk's
// source (002 contracts section 5.3, verbatim, $userId = the learner), followed by MENTIONS. db.idx.vector.queryNodes
// yields a cosine DISTANCE (lower is closer, spike S2), so similarity = 1.0 - distance and $minSimilarity is a
// similarity. The top-k is taken before the access filter. (2) A concept whose name or slug occurs in the goal text
// (seeded concepts have no chunks). The caller merges rows per concept and keeps the highest score.
CALL db.idx.vector.queryNodes('Chunk', 'embedding', $k, vecf32($embedding)) YIELD node AS ch, score
MATCH (s:Source)-[:HAS_CHUNK]->(ch)
WHERE ((:Learner {id: $userId})-[:OWNS]->(s) OR (s)-[:YIELDED]->(:Puzzle)-[:SHARED_WITH {withSource: true}]->(:Learner {id: $userId}))
WITH ch, 1.0 - score AS similarity
WHERE similarity >= $minSimilarity
MATCH (ch)-[:MENTIONS]->(c:Concept)
WITH c, ch, similarity
ORDER BY similarity DESC, ch.id ASC
WITH c, max(similarity) AS score, collect(ch.id)[0] AS bestChunkId
RETURN c.id AS conceptId, c.slug AS slug, c.name AS name, score, bestChunkId, 'passage' AS via
ORDER BY score DESC, name ASC, slug ASC
LIMIT $limit
UNION ALL
MATCH (c:Concept)
WHERE $goalText CONTAINS toLower(c.name) OR $goalSlugText CONTAINS c.slug
RETURN c.id AS conceptId, c.slug AS slug, c.name AS name, 1.0 AS score, null AS bestChunkId, 'name' AS via
ORDER BY name ASC, slug ASC
LIMIT $limit
