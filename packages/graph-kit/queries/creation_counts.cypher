// name: creation_counts
// owner: 002
// mode: read
// params: $userIds (list of strings), $monthStart (integer), $hourAgo (integer), $since (integer)
// returns: userId, uploadsThisMonth, promptsThisMonth, creationsLastHour
UNWIND $userIds AS userId
OPTIONAL MATCH (:Learner {id: userId})-[:OWNS]->(s:Source)
WHERE s.createdAt >= $since
RETURN userId,
       sum(CASE WHEN s.createdAt >= $monthStart AND s.kind <> 'prompt' THEN 1 ELSE 0 END) AS uploadsThisMonth,
       sum(CASE WHEN s.createdAt >= $monthStart AND s.kind = 'prompt'  THEN 1 ELSE 0 END) AS promptsThisMonth,
       sum(CASE WHEN s.createdAt >= $hourAgo THEN 1 ELSE 0 END) AS creationsLastHour
