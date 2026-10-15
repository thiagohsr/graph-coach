// name: play_puzzle
// owner: 003
// mode: read
// params: $puzzleId (string), $userId (string)
// returns: id, name, origin, questions, words
// Answer-free by construction: no column and no map key carries `answers`; answer words only appear inside `words`.
MATCH (p:Puzzle {id: $puzzleId})
// canPlay fragment (002 contracts §5.3), verbatim
WHERE p.status = 'published'
  AND (p.visibility = 'public'
       OR (:Learner {id: $userId})-[:OWNS]->(p)
       OR (p)-[:SHARED_WITH]->(:Learner {id: $userId}))
MATCH (p)-[r:CONTAINS]->(q:Question)
WHERE q.status = 'approved'
WITH p, q, r ORDER BY r.order
WITH p,
     collect({id: q.id, order: r.order, sentence: q.sentence, blanks: size(q.answers)}) AS questions,
     collect(q.answers + coalesce(q.distractors, [])) AS lists
UNWIND lists AS list
UNWIND list AS word
WITH p, questions, collect(DISTINCT word) AS words
RETURN p.id AS id, p.name AS name, p.origin AS origin, questions, words + coalesce(p.distractors, []) AS words
