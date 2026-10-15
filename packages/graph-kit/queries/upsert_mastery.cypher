// name: upsert_mastery
// owner: 003
// mode: write
// params: $learnerId (string), $rows (list of {conceptId, score, attempts, lastSeen})
// returns: conceptId, name, score, attempts, lastSeen
// Seed tooling and tests only; not on the submit path (reconciliation D2). Absolute values, idempotent.
MATCH (l:Learner {id: $learnerId})
UNWIND $rows AS row
MATCH (c:Concept {id: row.conceptId})
MERGE (l)-[h:HAS_MASTERY]->(c)
SET h.score = row.score, h.attempts = row.attempts, h.lastSeen = row.lastSeen
RETURN c.id AS conceptId, c.name AS name, h.score AS score, h.attempts AS attempts, h.lastSeen AS lastSeen
