// name: upsert_goal
// owner: 004
// mode: write
// params: $goalId (string), $learnerId (string), $text (string), $now (integer, epoch ms), $targets (list of {conceptId, score}, may be empty), $depth (integer 1..8)
// returns: goalId, targetIds, prerequisiteIds (one row; no row when $targets is empty, the goal is still written)
// Idempotent on the goal id: the learner's other goals become inactive, this one active; TARGETS edges are merged.
// The scope is the targets plus their upstream prerequisites; the traversal bound cannot be a parameter (spike), so the
// literal 8 (MAX_DEPTH) is used and $depth is applied as a filter.
MATCH (l:Learner {id: $learnerId})
OPTIONAL MATCH (l)-[:HAS_GOAL]->(old:Goal) WHERE old.id <> $goalId
SET old.active = false
WITH DISTINCT l
MERGE (g:Goal {id: $goalId})
  ON CREATE SET g.text = $text, g.createdAt = $now
SET g.active = true
MERGE (l)-[:HAS_GOAL]->(g)
WITH g
UNWIND $targets AS t
MATCH (c:Concept {id: t.conceptId})
MERGE (g)-[r:TARGETS]->(c)
SET r.score = t.score
WITH g, c
OPTIONAL MATCH path = (pre:Concept)-[:PREREQUISITE_OF*1..8]->(c)
WHERE length(path) <= $depth
RETURN g.id AS goalId, collect(DISTINCT c.id) AS targetIds, collect(DISTINCT pre.id) AS prerequisiteIds
