#!/usr/bin/env bash
# Fetch the WIDER public corpus for the viewer check (limits row 13, C3) into var/corpus-wide/ (gitignored).
#
# The C3 ruling: the viewer check compares a decoded-pixel hash per painted image, and its wrong refusals are
# measured on 50-100 MORE public PDFs than the 15 in var/corpus (scripts/c9-corpus-fetch.sh, kept separate so the
# C9 figures stay comparable). Third-party documents, never committed; this script makes the measurement
# reproducible. Shapes: IRS fillable forms (AcroForm widgets), IRS instructions and publications (long, with
# images), arXiv papers (raster figures, many images per file).
#
# Usage:  bash scripts/viewer-corpus-fetch.sh
# Then:   LOAD_GUARD_CORPUS=1 LOAD_GUARD_CORPUS_DIR=var/corpus-wide npx vitest run tests/utils/pdfLoadGuardCorpus.test.ts
set -euo pipefail

DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/var/corpus-wide"
mkdir -p "$DEST"

IRS=(fw2 fw3 fw4p fw7 fw8ben fw8bene f1040es f1040sa f1040sb f1040sd f1040se f1040sse f1040x f1065 f1120 f1120s
  f2848 f4506t f4868 f1040s8 f8829 f8863 f8879 f8962 f8949 f940 f1099nec f1099int f1099div f1099r f1098 f5498
  f4562 f8283 f9465 f1040v f2441 f8606 f8889 f8995 f843 f8822 f56 fss4
  p15 p501 p505 p526 p550 p590a p596 p970 p463 p334 p946 p1 p5 i1040gi i1065)
ARXIV=(1409.1556 1412.6980 1502.03167 1406.2661 1312.6114 1505.04597 1409.0473 1301.3781 1609.02907 1707.06347
  1312.5602 2010.11929 1910.10683 1907.11692 2103.00020 2006.11239 1611.07004 1703.10593 1608.06993 1506.02640
  1506.01497 1703.06870 1804.02767 1603.05027 1409.4842 2203.02155 2302.13971 2106.09685 1703.03400 1511.06434)

ok=0; bad=0
fetch() {
  local url="$1" name="$2"
  if [ -s "$DEST/$name" ] && [ "$(file -b --mime-type "$DEST/$name")" = "application/pdf" ]; then ok=$((ok + 1)); return; fi
  # A blocked fetch can answer an HTML page with a 200, so the TYPE is checked, not the exit code.
  if curl -sL --max-time 120 -o "$DEST/$name" "$url" && [ -s "$DEST/$name" ] \
     && [ "$(file -b --mime-type "$DEST/$name")" = "application/pdf" ]; then
    printf '  ok      %-28s %10s bytes\n' "$name" "$(stat -c%s "$DEST/$name")"; ok=$((ok + 1))
  else
    printf '  FAILED  %s\n' "$name"; rm -f "$DEST/$name"; bad=$((bad + 1))
  fi
}
for f in "${IRS[@]}"; do fetch "https://www.irs.gov/pub/irs-pdf/$f.pdf" "irs-$f.pdf"; done
for id in "${ARXIV[@]}"; do fetch "https://arxiv.org/pdf/$id" "arxiv-$id.pdf"; sleep 3; done

printf '\n%d present, %d failed -> %s\n' "$ok" "$bad" "$DEST"
[ "$ok" -ge 50 ]
