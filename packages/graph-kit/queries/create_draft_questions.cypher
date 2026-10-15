// name: create_draft_questions
// owner: 005
// mode: write
// params: $puzzleId (string), $taskId (string), $questions (list of {id, sentence, answers, distractors, order, chunkId, conceptSlugs}), $now (integer)
// returns: written
// Questions are created as `draft` only. GROUNDED_IN (the passage) and TESTS (the concepts) are written in the same
// query, so a draft is never stored without its trace. The caller compares `written` with the number sent; a
// difference means a concept or chunk vanished and the step fails. The caller sends batches of at most 25.
MATCH (p:Puzzle {id: $puzzleId}), (t:Task {id: $taskId})
UNWIND $questions AS row
MATCH (ch:Chunk {id: row.chunkId})
MERGE (q:Question {id: row.id})
  ON CREATE SET q.sentence = row.sentence, q.answers = row.answers, q.distractors = row.distractors,
                q.status = 'draft', q.createdAt = $now
MERGE (p)-[ct:CONTAINS]->(q)
  ON CREATE SET ct.order = row.order
MERGE (q)-[:GROUNDED_IN]->(ch)
MERGE (t)-[:PRODUCED]->(q)
WITH q, row
UNWIND row.conceptSlugs AS slug
MATCH (c:Concept {slug: slug})
MERGE (q)-[:TESTS]->(c)
RETURN count(DISTINCT q) AS written
