// name: publish_puzzle
// owner: 005
// mode: write
// params: $puzzleId (string), $minQuestions (integer or null)
// returns: id, status, visibility, origin, approved
// Internal (no access check; called after a decision that passed the owner filter). Sets `published` once the puzzle
// has at least $minQuestions approved questions; a null $minQuestions only reads. Idempotent and never reverts. Uses
// SET with CASE rather than SET inside FOREACH so that the returned status reflects the change.
MATCH (p:Puzzle {id: $puzzleId})
OPTIONAL MATCH (p)-[:CONTAINS]->(q:Question {status: 'approved'})
WITH p, count(q) AS approved
SET p.status = CASE WHEN $minQuestions IS NOT NULL AND approved >= $minQuestions THEN 'published' ELSE p.status END
RETURN p.id AS id, p.status AS status, p.visibility AS visibility, p.origin AS origin, approved
