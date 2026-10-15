// name: upsert_concepts
// owner: 005
// mode: write
// params: $taskId (string), $concepts (list of {id, slug, name, description, chunkIds}), $now (integer)
// returns: conceptId, slug
// MERGE on slug (the unique key). An existing concept is matched and left unchanged (never renamed); only MENTIONS and
// PRODUCED are added. With an empty chunkIds (the prompt path) no MENTIONS edge is written and nothing touches chunks.
// PRODUCED therefore means "concepts this run linked", created or matched. The caller sends batches of at most 20.
MATCH (t:Task {id: $taskId})
UNWIND $concepts AS row
MERGE (c:Concept {slug: row.slug})
  ON CREATE SET c.id = row.id, c.name = row.name, c.description = row.description, c.createdAt = $now
MERGE (t)-[:PRODUCED]->(c)
WITH c, row
OPTIONAL MATCH (ch:Chunk) WHERE ch.id IN row.chunkIds
FOREACH (_ IN CASE WHEN ch IS NULL THEN [] ELSE [1] END | MERGE (ch)-[:MENTIONS]->(c))
RETURN DISTINCT c.id AS conceptId, c.slug AS slug
