#!/usr/bin/env bash
# Proof-of-life: one real comet-qrng-v1 call against the live Atlas API.
set -euo pipefail
set -a; . ./.env.local; set +a
BASE="https://api.mothquantum.com/api/v1"
AUTH="Authorization: Bearer $MOTH_API_KEY"

echo "--- POST /engines/comet-qrng-v1/process ---"
SUBMIT=$(curl -sS -X POST "$BASE/engines/comet-qrng-v1/process" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"params":{"num_qubits":12,"shots":256,"mode":"emu","output_bytes":8,"include_raw_counts":false,
                 "derive":{"floats":1}}}')
echo "$SUBMIT"
JOB=$(printf '%s' "$SUBMIT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["job_id"])')
echo "job_id: $JOB"

echo "--- polling GET /jobs/$JOB/status ---"
for i in $(seq 1 60); do
  ST=$(curl -sS -H "$AUTH" "$BASE/jobs/$JOB/status")
  S=$(printf '%s' "$ST" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status"))')
  echo "[$i] status=$S"
  case "$S" in completed|failed|cancelled) break;; esac
  sleep 2
done
printf '%s\n' "$ST" | python3 -m json.tool

echo "--- GET /jobs/$JOB/result (RAW) ---"
curl -sS -H "$AUTH" "$BASE/jobs/$JOB/result"
echo
