#!/usr/bin/env bash
# Drive the planet copy to completion.
#
# The Worker copies 8 parts per call (100 MB each). Eight is the ceiling —
# sixteen trips Cloudflare's outbound connection limit ("Response closed due to
# connection limit"). At ~10 MB/s that is about 3.7 hours for 137.3 GB, once.
#
# Safe to stop and re-run: the Worker keeps its state in the bucket, so this
# picks up wherever it got to. Nothing streams through this machine — the
# request just tells Cloudflare to move the next 800 MB.
#
#   scripts/copy-planet.sh            # run to completion
#   scripts/copy-planet.sh status     # just report
set -uo pipefail

W="${BASEMAP_WORKER:-https://adventureorno-basemap.adventureorno26.workers.dev}"
LOG="${COPY_LOG:-/tmp/planet-copy.log}"

pct() { python3 -c "import json,sys;d=json.load(sys.stdin);print(f\"{d.get('parts','?')} {d.get('percent','?')}% {d.get('error','')}\".strip())" 2>/dev/null; }

if [ "${1:-run}" = "status" ]; then
  curl -s "$W/copy/status"
  exit 0
fi

fails=0
while :; do
  out="$(curl -s --max-time 300 "$W/copy/step?n=8")"
  line="$(printf '%s' "$out" | pct)"
  printf '%s  %s\n' "$(date +%H:%M:%S)" "$line" | tee -a "$LOG"

  case "$line" in
    *'100%'*|*'done'*) ;;
  esac

  if printf '%s' "$out" | grep -q '"done": true'; then
    echo "$(date +%H:%M:%S)  COPY COMPLETE" | tee -a "$LOG"
    break
  fi

  # A failed batch records nothing, so the same parts are simply retried.
  if printf '%s' "$out" | grep -q '"error"'; then
    fails=$((fails + 1))
    if [ "$fails" -ge 12 ]; then
      echo "$(date +%H:%M:%S)  GIVING UP after $fails consecutive failures" | tee -a "$LOG"
      exit 1
    fi
    sleep $((fails * 5))
  else
    fails=0
  fi
done
