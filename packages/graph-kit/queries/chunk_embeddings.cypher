// name: chunk_embeddings
// owner: 005
// mode: read
// params: $sourceId (string)
// returns: id, embedding
// INTERNAL: the stored vectors of a source's chunks, in chunk order, for `extractConcepts` (the neighbourhood search is
// made with each chunk's own vector). A vector property comes back as a plain number array (spike S2). Chunks without a
// vector are left out. Not served to any request.
MATCH (:Source {id: $sourceId})-[:HAS_CHUNK]->(c:Chunk)
WHERE c.embedding IS NOT NULL
RETURN c.id AS id, c.embedding AS embedding
ORDER BY c.position ASC
