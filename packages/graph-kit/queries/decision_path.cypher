// name: decision_path
// owner: 004
// mode: read
// params: $decisionId (string), $learnerId (string, the learner the decision is for), $userId (string, the viewer), $depth (integer 1..8)
// returns: part, fromLabel, fromId, fromData, type, toLabel, toId, toData, role, reason, weight
// The stored "why" subgraph as uniform rows. Every branch is anchored on (d)-[:FOR]->(l {id: $learnerId}), so only that
// learner's data can be returned. *Data maps hold whitelisted properties only (Question: sentence; Learner: displayName;
// never answers, distractors, or submitted words). The general evidence branch excludes role 'passage'; the passage
// branch returns a chunk excerpt only when the viewer passes canReadSource (002 contracts section 5.3, verbatim).
MATCH (ag:Agent)-[:MADE]->(d:Decision {id: $decisionId})-[:FOR]->(l:Learner {id: $learnerId})
RETURN 'made' AS part, 'Agent' AS fromLabel, ag.name AS fromId, {name: ag.name} AS fromData,
       'MADE' AS type, 'Decision' AS toLabel, d.id AS toId,
       {kind: d.kind, summary: d.summary, createdAt: d.createdAt, flags: coalesce(d.flags, [])} AS toData,
       null AS role, 'decided by the Coach' AS reason, null AS weight
UNION ALL
MATCH (d:Decision {id: $decisionId})-[:FOR]->(l:Learner {id: $learnerId})
RETURN 'for' AS part, 'Decision' AS fromLabel, d.id AS fromId, {} AS fromData,
       'FOR' AS type, 'Learner' AS toLabel, l.id AS toId, {displayName: l.displayName} AS toData,
       null AS role, 'decided for this learner' AS reason, null AS weight
UNION ALL
MATCH (p:Puzzle)<-[:RECOMMENDED]-(d:Decision {id: $decisionId})-[:FOR]->(:Learner {id: $learnerId})
RETURN 'recommended' AS part, 'Decision' AS fromLabel, d.id AS fromId, {} AS fromData,
       'RECOMMENDED' AS type, 'Puzzle' AS toLabel, p.id AS toId, {name: p.name} AS toData,
       null AS role, 'recommended puzzle' AS reason, null AS weight
UNION ALL
MATCH (e)<-[b:BECAUSE]-(d:Decision {id: $decisionId})-[:FOR]->(:Learner {id: $learnerId})
WHERE b.role <> 'passage'
OPTIONAL MATCH (e)-[:OF]->(sp:Puzzle)
RETURN 'because' AS part, 'Decision' AS fromLabel, d.id AS fromId, {} AS fromData,
       'BECAUSE' AS type, labels(e)[0] AS toLabel, e.id AS toId,
       {name: e.name, slug: e.slug, sentence: e.sentence,
        submittedAt: e.submittedAt, score: e.score, maxScore: e.maxScore,
        puzzleId: sp.id, puzzleName: sp.name} AS toData,
       b.role AS role, b.reason AS reason, b.weight AS weight
UNION ALL
MATCH (t:Concept)<-[bt:BECAUSE]-(d:Decision {id: $decisionId})-[:FOR]->(:Learner {id: $learnerId})
WHERE bt.role = 'target'
MATCH (d)-[bd:BECAUSE]->(x:Concept) WHERE bd.role = 'driver'
MATCH chain = (t)-[:PREREQUISITE_OF*1..8]->(x)
WHERE length(chain) <= $depth
UNWIND range(0, length(chain) - 1) AS i
WITH DISTINCT nodes(chain)[i] AS a, nodes(chain)[i + 1] AS b
RETURN 'chain' AS part, 'Concept' AS fromLabel, a.id AS fromId, {name: a.name, slug: a.slug} AS fromData,
       'PREREQUISITE_OF' AS type, 'Concept' AS toLabel, b.id AS toId, {name: b.name, slug: b.slug} AS toData,
       null AS role, 'prerequisite of' AS reason, null AS weight
UNION ALL
MATCH (s:Session)<-[:BECAUSE]-(d:Decision {id: $decisionId})-[:FOR]->(:Learner {id: $learnerId})
MATCH (d)-[:BECAUSE]->(q:Question)<-[an:ANSWERED]-(s)
WITH s, q, count(an) AS blanks, sum(CASE WHEN an.correct THEN 0 ELSE 1 END) AS wrong
WHERE wrong > 0
RETURN 'answered' AS part, 'Session' AS fromLabel, s.id AS fromId, {} AS fromData,
       'ANSWERED' AS type, 'Question' AS toLabel, q.id AS toId, {} AS toData,
       null AS role, toString(wrong) + ' of ' + toString(blanks) + ' blanks wrong' AS reason, null AS weight
UNION ALL
MATCH (q:Question)<-[:BECAUSE]-(d:Decision {id: $decisionId})-[:FOR]->(:Learner {id: $learnerId})
MATCH (d)-[:BECAUSE]->(c:Concept)<-[:TESTS]-(q)
RETURN 'tests' AS part, 'Question' AS fromLabel, q.id AS fromId, {} AS fromData,
       'TESTS' AS type, 'Concept' AS toLabel, c.id AS toId, {} AS toData,
       null AS role, 'tests' AS reason, null AS weight
UNION ALL
MATCH (k:Chunk)<-[b:BECAUSE]-(d:Decision {id: $decisionId})-[:FOR]->(:Learner {id: $learnerId})
WHERE b.role = 'passage'
MATCH (s:Source)-[:HAS_CHUNK]->(k)
WHERE ((:Learner {id: $userId})-[:OWNS]->(s)
       OR (s)-[:YIELDED]->(:Puzzle)-[:SHARED_WITH {withSource: true}]->(:Learner {id: $userId}))
RETURN 'passage' AS part, 'Decision' AS fromLabel, d.id AS fromId, {} AS fromData,
       'BECAUSE' AS type, 'Chunk' AS toLabel, k.id AS toId,
       {excerpt: left(k.text, 160), sourceTitle: s.title} AS toData,
       b.role AS role, b.reason AS reason, b.weight AS weight
