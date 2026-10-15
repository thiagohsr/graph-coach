// name: source_chunks
// owner: 005
// mode: read
// params: $sourceId (string)
// returns: sourceTitle, sourceKind, sourceContent, sourceBrief, sourceOutline, id, position, text, hasEmbedding, concepts
// INTERNAL: the pipeline's read of a source's text and its ordered chunks (and the concepts each chunk mentions). It
// returns Source.content to the pipeline only; no controller calls it (request handlers read the text through
// get_source). One row with null chunk columns when the source has no chunk (always so for a prompt source). A chunk
// with no concept yields one map of nulls in `concepts`, which the caller drops. Chunk vectors are not returned here.
// Deviation from the draft: the concepts are collected in a WITH before the source columns are projected. On the pinned
// FalkorDB (6.0.2) a RETURN that mixes collect() with properties no node has yet (brief and outline exist only once a
// prompt source was written) crashed the server when the source had no chunk; this order does not (spike note, 005).
MATCH (s:Source {id: $sourceId})
OPTIONAL MATCH (s)-[:HAS_CHUNK]->(ch:Chunk)
OPTIONAL MATCH (ch)-[:MENTIONS]->(c:Concept)
WITH s, ch, collect(DISTINCT {id: c.id, slug: c.slug, name: c.name, description: c.description}) AS concepts
RETURN s.title AS sourceTitle, s.kind AS sourceKind, s.content AS sourceContent,
       s.brief AS sourceBrief, s.outline AS sourceOutline,
       ch.id AS id, ch.position AS position, ch.text AS text,
       ch.embedding IS NOT NULL AS hasEmbedding, concepts
ORDER BY position ASC
