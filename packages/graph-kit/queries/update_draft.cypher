// name: update_draft
// owner: 005
// mode: write
// params: $questionId (string), $userId (string), $sentence (string), $answers (list of strings), $distractors (list of strings)
// returns: id
// No row = the question is not a draft, or not in a puzzle the caller owns (whatever the caller's role). The service
// sends the full merged values after validating them. TESTS edges and `critique` are never touched.
MATCH (u:Learner {id: $userId})-[:OWNS]->(p:Puzzle)-[:CONTAINS]->(q:Question {id: $questionId})
WHERE q.status = 'draft'
SET q.sentence = $sentence, q.answers = $answers, q.distractors = $distractors
RETURN q.id AS id
