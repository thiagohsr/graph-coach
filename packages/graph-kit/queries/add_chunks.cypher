// name: add_chunks
// owner: 005
// mode: write
// params: $sourceId (string), $chunks (list of {id, position, text, prevId or null, embedding or null})
// returns: written
// Used twice: by `chunk` with embedding = null, by `embed` with the vectors. A MERGE on the chunk id, so a repeat
// updates in place; an embedding that is null leaves any stored vector alone. A vector is stored with vecf32(); a
// Chunk without one is simply absent from the vector index.
MATCH (s:Source {id: $sourceId})
UNWIND $chunks AS row
MERGE (c:Chunk {id: row.id})
SET c.text = row.text, c.position = row.position
MERGE (s)-[:HAS_CHUNK]->(c)
FOREACH (_ IN CASE WHEN row.embedding IS NULL THEN [] ELSE [1] END |
  SET c.embedding = vecf32(row.embedding))
WITH c, row
OPTIONAL MATCH (prev:Chunk {id: row.prevId})
FOREACH (_ IN CASE WHEN prev IS NULL THEN [] ELSE [1] END |
  MERGE (prev)-[:NEXT]->(c))
RETURN count(DISTINCT c) AS written
