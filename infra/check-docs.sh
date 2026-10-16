#!/usr/bin/env bash
# Documentation check (spec 008, T053). For every named query file in packages/graph-kit/queries/ (setup/ excluded),
# the query name must appear in README.md or in a graph-query test (packages/graph-kit/test/*.queries.spec.ts).
# Prints the name of each query that appears in neither, and exits 1 if there is any. Names missing from the README
# alone are listed as notes and do not fail the check.
set -u
cd "$(dirname "$0")/.."

queries_dir="packages/graph-kit/queries"
readme="README.md"
shopt -s nullglob
specs=(packages/graph-kit/test/*.queries.spec.ts)

failed=0
checked=0
for file in "$queries_dir"/*.cypher; do
  name=$(basename "$file" .cypher)
  checked=$((checked + 1))
  in_readme=0
  in_spec=0
  grep -Fqw -- "$name" "$readme" 2>/dev/null && in_readme=1
  if [ "${#specs[@]}" -gt 0 ] && grep -Fqw -- "$name" "${specs[@]}" 2>/dev/null; then in_spec=1; fi
  if [ "$in_readme" -eq 0 ] && [ "$in_spec" -eq 0 ]; then
    echo "FAIL  $name: not in $readme and not in any packages/graph-kit/test/*.queries.spec.ts"
    failed=1
  elif [ "$in_readme" -eq 0 ]; then
    echo "note  $name: tested, but not in $readme"
  fi
done

if [ "$checked" -eq 0 ]; then
  echo "FAIL  no query files found in $queries_dir"
  exit 1
fi
if [ "$failed" -eq 0 ]; then
  echo "docs-check: ok ($checked queries)"
fi
exit "$failed"
