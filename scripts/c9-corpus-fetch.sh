#!/usr/bin/env bash
# Rebuild the C9 evaluation corpus in var/corpus/ (gitignored).
#
# The corpus is NOT committed — these are third-party documents, and the repo should not carry
# megabytes of them. This script makes the measurement reproducible instead: the same 15 public
# documents, fetched from their canonical URLs. See KNOWN_ISSUES.md C9 for what was measured and
# docs/plans/master.plan.md's Decisions Log for the ruling.
#
# Shapes covered: forms (IRS, GSA, USPTO), articles (arXiv, 1- and 2-column), reports (Census,
# US budget, IRS Pub 17). NOT covered: real invoices and bank statements — genuine ones are private
# documents and no public sample was obtained. That gap is disclosed rather than papered over.
#
# Usage:  bash scripts/c9-corpus-fetch.sh
# Then:   C9_CORPUS=1 npx vitest run tests/tools/c9Corpus.test.ts
#         (without C9_CORPUS the probe SKIPS silently — it is double-gated so it never runs
#          inside `npm run test` or the pre-push hook)
set -euo pipefail

DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/var/corpus"
mkdir -p "$DEST"

FILES=(
  "https://www.irs.gov/pub/irs-pdf/fw9.pdf|form-irs-w9.pdf"
  "https://www.irs.gov/pub/irs-pdf/fw4.pdf|form-irs-w4.pdf"
  "https://www.irs.gov/pub/irs-pdf/f1040.pdf|form-irs-1040.pdf"
  "https://www.irs.gov/pub/irs-pdf/f1040sc.pdf|form-irs-1040-schedC.pdf"
  "https://www.irs.gov/pub/irs-pdf/f1099msc.pdf|form-irs-1099misc.pdf"
  "https://www.irs.gov/pub/irs-pdf/f941.pdf|form-irs-941.pdf"
  "https://www.irs.gov/pub/irs-pdf/p17.pdf|report-irs-pub17.pdf"
  "https://www.gsa.gov/system/files/SF1449-21.pdf|form-gsa-1449-invoice.pdf"
  "https://www.uspto.gov/sites/default/files/documents/sb0016.pdf|form-uspto-sb16.pdf"
  "https://www.census.gov/content/dam/Census/library/publications/2023/demo/p60-280.pdf|report-census-income.pdf"
  "https://www.govinfo.gov/content/pkg/BUDGET-2024-BUD/pdf/BUDGET-2024-BUD-1.pdf|report-us-budget.pdf"
  "https://arxiv.org/pdf/1706.03762|article-attention-1col.pdf"
  "https://arxiv.org/pdf/1512.03385|article-resnet-2col.pdf"
  "https://arxiv.org/pdf/1810.04805|article-bert-2col.pdf"
  "https://arxiv.org/pdf/2005.14165|article-gpt3-1col.pdf"
)

ok=0; bad=0
for entry in "${FILES[@]}"; do
  url="${entry%%|*}"; name="${entry##*|}"
  # A blocked or redirected fetch returns an HTML error page with a 200, which is why the type is
  # checked rather than the exit code: four of the first attempts landed as text/html and would have
  # been silently counted as corpus files.
  if curl -sL --max-time 90 -o "$DEST/$name" "$url" \
     && [ -s "$DEST/$name" ] \
     && [ "$(file -b --mime-type "$DEST/$name")" = "application/pdf" ]; then
    printf '  ok      %-32s %9s bytes\n' "$name" "$(stat -c%s "$DEST/$name")"
    ok=$((ok + 1))
  else
    printf '  FAILED  %s\n' "$name"
    rm -f "$DEST/$name"
    bad=$((bad + 1))
  fi
done

printf '\n%d fetched, %d failed → %s\n' "$ok" "$bad" "$DEST"
[ "$ok" -gt 0 ]
