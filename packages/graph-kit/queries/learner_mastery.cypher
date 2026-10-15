// name: learner_mastery
// owner: 003
// mode: read
// params: $learnerId (string), $conceptIds (list of string, or null for all)
// returns: conceptId, name, score, attempts, lastSeen
MATCH (:Learner {id: $learnerId})-[h:HAS_MASTERY]->(c:Concept)
WHERE $conceptIds IS NULL OR c.id IN $conceptIds
RETURN c.id AS conceptId, c.name AS name, h.score AS score, h.attempts AS attempts, h.lastSeen AS lastSeen
ORDER BY name
