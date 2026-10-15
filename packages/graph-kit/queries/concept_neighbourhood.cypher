// name: concept_neighbourhood
// owner: 005
// mode: read
// params: $embedding (list of floats), $fetchK (integer), $maxDistance (float)
// returns: conceptId, slug, name, description, hits, bestDistance
// Vector search over ALL chunks followed by MENTIONS, in one query (spike S2). It takes no access parameters because it
// returns concept fields only (concepts are global): no chunk id, no chunk text, no source id ever leaves the query.
// Restricting it would stop near-duplicate detection against concepts that so far appear only in other users' private
// sources. `score` is a cosine DISTANCE: lower is closer.
CALL db.idx.vector.queryNodes('Chunk', 'embedding', $fetchK, vecf32($embedding)) YIELD node AS ch, score
WITH ch, score WHERE score <= $maxDistance
MATCH (ch)-[:MENTIONS]->(c:Concept)
RETURN c.id AS conceptId, c.slug AS slug, c.name AS name, c.description AS description,
       count(ch) AS hits, min(score) AS bestDistance
ORDER BY bestDistance ASC, hits DESC
LIMIT 15
