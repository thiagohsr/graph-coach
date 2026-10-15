// name: create_generated_questions
// owner: 005
// mode: write
// params: $puzzleId (string), $taskId (string), $sourceId (string), $questions (list of {id, sentence, answers, distractors, order, conceptSlugs, critique (JSON string)}), $now (integer)
// returns: written
// The prompt counterpart of create_draft_questions: no chunk and no GROUNDED_IN. A question is created as `draft` only,
// linked to the brief's source (GENERATED_FROM) and to its concepts (TESTS) in the same query, so a draft is never stored
// without its trace. The source must be a prompt source. Only drafts the critic passed are sent, so every stored prompt
// draft has critique.verdict = 'pass'. The caller compares `written` with the number sent. Repeating the call changes
// nothing: MERGE on the question id, the CONTAINS edge keeps its first order.
MATCH (p:Puzzle {id: $puzzleId}), (t:Task {id: $taskId}), (s:Source {id: $sourceId, kind: 'prompt'})
UNWIND $questions AS row
MERGE (q:Question {id: row.id})
  ON CREATE SET q.sentence = row.sentence, q.answers = row.answers, q.distractors = row.distractors,
                q.status = 'draft', q.critique = row.critique, q.createdAt = $now
MERGE (p)-[ct:CONTAINS]->(q)
  ON CREATE SET ct.order = row.order
MERGE (q)-[:GENERATED_FROM]->(s)
MERGE (t)-[:PRODUCED]->(q)
WITH q, row
UNWIND row.conceptSlugs AS slug
MATCH (c:Concept {slug: slug})
MERGE (q)-[:TESTS]->(c)
RETURN count(DISTINCT q) AS written
