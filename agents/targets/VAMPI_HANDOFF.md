# VAmPI execution handoff — unresolved build gate

Mahmoud supplied source commit `f16052dce83f05847133ec98f01c5193a41de7d8`, workspace
`/vampi`, and books.py SHA-256
`78e2eb77d655573f03b7a4d0bca73dc27383b0c5ec7882a5aa8608caa52828e8`.
The merged contract, Dockerfile, probe, seed and hash scripts were inspected through
`origin/main` without merging or changing teammate files.

The source says `User.init_db_users` calls `register_user`, which creates a random
book for every user. Therefore the handoff's claim that `/createdb` creates zero books
is inconsistent with the pin. Repeated reset may also collide on unique book titles.
The supplied API-state hash concatenates selected HTTP responses; it neither
canonicalizes JSON nor measures all SQLite rows, ownership, secrets and auth data.
It cannot establish canonical database equality.

For the hackathon, prepare one validated database with exactly the agreed records,
stop VAmPI, measure/save that artifact, and restore its bytes for every reset. Record
all expected book titles (including any intentionally retained initial books). Do not
invent the resulting hash or silently omit unexpected records. Runtime checks require
the restored hash to match twice while stopped and reject SQLite journal sidecars.
This canonical preparation is separate from candidate repair; agents cannot alter seed data.

Still needed before a live run:

- Built image identity and prepared Daytona snapshot name/ID. If an image is used,
  supply its immutable `repository@sha256:...` registry reference. A local image ID
  from `docker inspect .Id` identifies a different object; record it as build evidence,
  not as a registry manifest digest. The Dockerfile's floating base/dependencies mean
  a source pin alone does not guarantee deterministic image builds.
- Canonical baseline ID; measured hashes of all manifest source/config files and
  `.pinned_sha`; stopped database artifact/hash and tested reset evidence.
- Tested snapshot-specific stop, assert_stopped, reset, start, readiness and offline
  check commands. A Docker host command is not automatically an in-sandbox action.
- Samer's running API URL, approved run, actual red-team finding/evidence IDs.
- Local Daytona and chosen model-provider credentials; selected model identifier.
- Hamza's authorized private sandbox access and agreed inspection window.

Acceptance: name1/pass1 owns `restorelab-bola-book`, secret
`S3CR3T-name1-canonical`; name2/pass2 owns `restorelab-name2-book` with secret
`S3CR3T-name2-canonical` and is the foreign reader for name1's book. Log in afresh via
`POST /users/v1/login` and use `Authorization: Bearer <auth_token>`. Owner must retain
HTTP 200 and exact contents; foreign reader must get 404 without the secret. Check
seed records, authentication, readiness, other legitimate book use and flag1.
Setup/token/service failures are UNKNOWN or failed setup, never PASS. The flag0
instance is reference-only. Hamza owns independent verdicts; other vulnerabilities
are outside this task.

Pinned source inspected:
https://github.com/erev0s/VAmPI/blob/f16052dce83f05847133ec98f01c5193a41de7d8/models/user_model.py
