#!/usr/bin/env bash
# The "remove the graph" check (spec 008, T054; contract: the design documents).
# Performs steps 1 to 10 against the LOCAL setup (make up, make migrate, make seed, make dev running, AUTH_MODE=dev).
# Steps 11 and 12 are done by hand in a browser. Never run this against the live site: it stops FalkorDB.
#
# It stops the graph container, so run it only when nobody else is using the local stores. The graph is always
# started again on exit, whatever happened.
#
# Environment: API_BASE (default http://localhost:${API_PORT:-3001}/api), DEMO_EMAIL (default learner@example.test),
# SOURCE_FILE (default seed/sources/b-trees-and-indexes.md; the contract's caching-basics.md is not in seed/).
# Needs: bash, curl, node, make, docker compose (through the Makefile).
set -u
cd "$(dirname "$0")/.."

if [ -z "${API_BASE:-}" ]; then
  port="${API_PORT:-}"
  if [ -z "$port" ] && [ -f .env ]; then
    port=$(grep -E '^API_PORT=' .env | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  fi
  API_BASE="http://localhost:${port:-3001}/api"
fi
DEMO_EMAIL="${DEMO_EMAIL:-learner@example.test}"
SOURCE_FILE="${SOURCE_FILE:-seed/sources/b-trees-and-indexes.md}"
MAX_TIME=10          # a request slower than this counts as a hang (fail condition)
WAIT_HEALTH_SECS=90  # how long to wait for the graph to be healthy again

failed=0
graph_stopped=0
token=""
status=""
body=""

# Reads JSON on stdin and prints the value of a dotted path, or nothing.
jget() {
  node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      try {
        let v = JSON.parse(s);
        for (const k of process.argv[1].split(".")) v = v == null ? undefined : v[k];
        if (v !== undefined && v !== null) process.stdout.write(typeof v === "object" ? JSON.stringify(v) : String(v));
      } catch (e) {}
    });
  ' "$1"
}

# Prints the length of a JSON array on stdin, or -1 when it is not an array.
jlen() {
  node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      try {
        const v = JSON.parse(s);
        process.stdout.write(String(Array.isArray(v) ? v.length : -1));
      } catch (e) {
        process.stdout.write("-1");
      }
    });
  '
}

# request METHOD PATH [JSON_BODY_FROM_STDIN=1]: sets $status and $body. Status 000 means no answer within MAX_TIME.
request() {
  local method="$1" path="$2" with_body="${3:-0}" out
  local args=(-sS --max-time "$MAX_TIME" -X "$method" -H 'Accept: application/json' -w $'\n%{http_code}')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  if [ "$with_body" = "1" ]; then
    args+=(-H 'Content-Type: application/json' --data-binary @-)
  fi
  out=$(curl "${args[@]}" "$API_BASE$path" 2>/dev/null) || true
  status="${out##*$'\n'}"
  body="${out%$'\n'*}"
  case "$status" in
    [0-9][0-9][0-9]) ;;
    *) status="000"; body="" ;;
  esac
}

# report STEP LABEL EXPECTED_STATUS EXPECTED_CODE [extra detail]; marks the check failed when it does not match.
report() {
  local step="$1" label="$2" want_status="$3" want_code="$4" extra="${5:-}"
  local code message verdict="ok"
  code=$(printf '%s' "$body" | jget error.code)
  message=$(printf '%s' "$body" | jget error.message)
  [ "$status" != "$want_status" ] && verdict="FAIL"
  [ -n "$want_code" ] && [ "$code" != "$want_code" ] && verdict="FAIL"
  if [ "$status" = "000" ]; then message="no answer within ${MAX_TIME}s"; fi
  [ "$verdict" = "FAIL" ] && failed=1
  printf '%-4s %-5s %-44s expected %s %-18s observed %s %-18s %s%s\n' \
    "$step" "$verdict" "$label" "$want_status" "${want_code:--}" "$status" "${code:--}" "${message:+\"$message\"}" "${extra:+ $extra}"
}

fail_note() { failed=1; printf '%-4s FAIL  %s\n' "$1" "$2"; }

restart_graph() {
  if [ "$graph_stopped" -eq 1 ]; then
    echo "-- restarting FalkorDB (make graph-start)"
    make graph-start >/dev/null 2>&1 && graph_stopped=0 || echo "-- could not restart FalkorDB; run: make graph-start"
  fi
}
trap restart_graph EXIT
trap 'exit 130' INT TERM

echo "Remove-the-graph check against $API_BASE (user $DEMO_EMAIL)"
echo "Image: $(grep -E 'image: *falkordb' infra/docker-compose.yml | head -n 1 | tr -s ' ' | cut -d' ' -f3)"
echo

# Step 1: token for the demo learner.
printf '{"email":"%s"}' "$DEMO_EMAIL" | request POST /auth/dev-login 1
token=$(printf '%s' "$body" | jget accessToken)
report 1 "POST /auth/dev-login" 200 ""
if [ -z "$token" ]; then
  fail_note 1 "no access token; is make dev running with AUTH_MODE=dev and the seed loaded?"
  exit 1
fi

# Step 2: baseline health.
request GET /health
report 2 "baseline GET /health" 200 "" "$(printf '%s' "$body")"
[ "$(printf '%s' "$body" | jget graph)" = "ok" ] && [ "$(printf '%s' "$body" | jget sql)" = "ok" ] || fail_note 2 "baseline health is not graph ok and sql ok: $body"

# Step 3: baseline recommendation, and the mastery count to compare with after the restart.
printf '{}' | request POST /coach/recommendations 1
report 3 "baseline POST /coach/recommendations" 201 ""
[ -n "$(printf '%s' "$body" | jget decisionId)" ] || fail_note 3 "no decisionId in the baseline recommendation"
request GET /me/mastery
mastery_before=$(printf '%s' "$body" | jlen)
if [ "$status" != "200" ] || [ "$mastery_before" -lt 1 ]; then
  fail_note 3 "baseline GET /me/mastery gave status $status and $mastery_before rows (expected 200 and at least one row; was make seed run?)"
fi

# Step 4: stop the graph.
echo
echo "-- stopping FalkorDB (make graph-stop)"
if make graph-stop >/dev/null 2>&1; then
  graph_stopped=1
else
  fail_note 4 "make graph-stop failed"
  exit 1
fi
sleep 2

# Step 5: health shows graph down while the API is still up.
request GET /health
report 5 "GET /health, graph stopped" 200 "" "$(printf '%s' "$body")"
if [ "$(printf '%s' "$body" | jget graph)" != "down" ] || [ "$(printf '%s' "$body" | jget api)" != "ok" ] || [ "$(printf '%s' "$body" | jget sql)" != "ok" ]; then
  fail_note 5 "expected api ok, graph down, sql ok; got: $body"
fi

# Step 6: no recommendation and no fallback answer.
printf '{}' | request POST /coach/recommendations 1
report 6 "POST /coach/recommendations" 503 GRAPH_UNAVAILABLE
if [ "$(printf '%s' "$body" | jget error.code)" = "DECISION_NOT_RECORDED" ]; then
  echo "     note: DECISION_NOT_RECORDED is a deviation for spec 004 (the request still failed)"
fi
if [ "${status:0:1}" = "2" ]; then fail_note 6 "a 2xx answer while the graph is stopped"; fi

# Step 7: a source is not accepted, no task is created.
node -e '
  const fs = require("fs");
  const content = fs.readFileSync(process.argv[1], "utf8");
  process.stdout.write(JSON.stringify({ title: "Remove-the-graph probe", kind: "markdown", content }));
' "$SOURCE_FILE" | request POST /sources 1
report 7 "POST /sources" 503 GRAPH_UNAVAILABLE
if [ "$status" = "200" ] || [ "$status" = "202" ]; then fail_note 7 "a source was accepted while the graph is stopped"; fi

# Step 8: play, memory, and sources all live in the graph.
request GET /puzzles;      report 8 "GET /puzzles" 503 GRAPH_UNAVAILABLE
request GET /me/mastery;   report 8 "GET /me/mastery" 503 GRAPH_UNAVAILABLE
request GET /sources;      report 8 "GET /sources" 503 GRAPH_UNAVAILABLE

# Step 9: accounts live in Postgres.
request GET /auth/me;      report 9 "GET /auth/me" 200 ""

# Step 10: start the graph again and check that everything is back.
echo
echo "-- starting FalkorDB (make graph-start)"
if make graph-start >/dev/null 2>&1; then
  graph_stopped=0
else
  fail_note 10 "make graph-start failed"
  exit 1
fi
healthy=0
waited=0
while [ "$waited" -lt "$WAIT_HEALTH_SECS" ]; do
  request GET /health
  if [ "$status" = "200" ] && [ "$(printf '%s' "$body" | jget graph)" = "ok" ]; then healthy=1; break; fi
  sleep 2
  waited=$((waited + 2))
done
[ "$healthy" -eq 1 ] || fail_note 10 "health did not report graph ok within ${WAIT_HEALTH_SECS}s (the API may need a restart: a fail condition)"

request GET /health
report 10 "GET /health, graph restarted" 200 "" "$(printf '%s' "$body")"
printf '{}' | request POST /coach/recommendations 1
report 10 "POST /coach/recommendations, restarted" 201 "" "reused=$(printf '%s' "$body" | jget reused)"
[ -n "$(printf '%s' "$body" | jget decisionId)" ] || fail_note 10 "no decisionId after the restart"
request GET /me/mastery
mastery_after=$(printf '%s' "$body" | jlen)
report 10 "GET /me/mastery, restarted" 200 "" "rows before=$mastery_before after=$mastery_after"
if [ "$mastery_after" -lt "$mastery_before" ]; then fail_note 10 "mastery recorded before the stop is missing after the restart"; fi

echo
if [ "$failed" -eq 0 ]; then
  echo "Result: no fail condition met (steps 1-10). Steps 11 and 12 are still to be done by hand in a browser."
  exit 0
fi
echo "Result: at least one fail condition was met (see FAIL lines above)."
exit 1
