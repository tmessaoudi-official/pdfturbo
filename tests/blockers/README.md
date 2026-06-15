# Blockers-to-100% confirming tests

Empirical proof for the blockers enumerated in
`docs/reviews/research-2026-06-15-blockers/CONSOLIDATED.md`.

**Convention:** a REACHABLE blocker is asserted with vitest **`it.fails(...)`** —
the test states the *desired/correct* behavior and is GREEN precisely because that
behavior fails today. The moment someone fixes the blocker, `it.fails` flips RED and
forces the test to be converted to a normal passing assertion. This keeps CI green
while proving every blocker is real and giving the fix a built-in finish line.

CEILING blockers (no client-side fix) are asserted with a normal passing `it` that
**pins** the current degraded behavior, so a future change that alters it is noticed.

Non-deterministic blockers (OCR recognition quality, timing, network) are NOT encoded
here — they are evidence-only in the consolidated report.
