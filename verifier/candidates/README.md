# Independent VAmPI candidate verification

Verify only real source-patched candidates forked from the same immutable,
seeded `vulnerable=1` snapshot. The approved patch scope is
`api_views/books.py`; changing the global flag to `vulnerable=0` is not a
candidate. The pinned VAmPI source and canonical seed process are documented
in [the target contract](../../redteam/vampi-contract.md).

The verifier logs in to `name1` and `name2` with the synthetic seed identities
in [identities.ts](../identities.ts). It checks the canonical books plus a new
book it creates for `name2`. Do not run against an unseeded container or reseed
one candidate after it has been forked.

Set `ALLOWED_TARGETS` to the actual candidate origins. The `:5001`
`vulnerable=0` comparator is always refused, even if listed as allowed.

```bash
cd verifier
ALLOWED_TARGETS=http://127.0.0.1:5000 npm run verify -- \
  --url http://127.0.0.1:5000 --candidate CANDIDATE_ID --run RUN_ID \
  --api http://127.0.0.1:4000 --no-trace
```

`--api` posts the verifier's actual test evidence first and then its immutable
verdict to the shared API. If publication fails partway through, inspect the
run's evidence and verdict endpoints before retrying; the API refuses duplicate
verdicts. Omitting `--api` prints a local verdict only. The CLI must be able to
reach the candidate before Belal's retention deadline. The backend's report
selects among candidates only after it receives independent verdicts.

The scope guard returns exit code 4 for the `:5001` comparator and 3 for
other disallowed origins. A pass exits 0, fail 1 and unknown 2.
