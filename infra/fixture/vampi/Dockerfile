# Reproducible VAmPI baseline for RestoreLab, pinned to a specific source commit.
# Builds the VULNERABLE baseline (vulnerable=1). Candidates fork from the resulting image;
# recovery agents edit /vampi/api_views/books.py in-sandbox and restart `python app.py`.
#
# Build (Belal records the resulting digest in redteam/vampi-contract.md):
#   docker build -f infra/fixture/vampi/Dockerfile -t restorelab-vampi:pinned infra/fixture/vampi
#   docker inspect --format '{{.Id}}' restorelab-vampi:pinned   # build evidence (local id, not a registry digest)
#
# Determinism: the SOURCE is pinned by commit AND verified below against baseline.sha256, so a
# build fails if the pinned tree ever drifts. The base image tag and pip deps still float, so
# the build is NOT bit-reproducible from scratch — the authoritative anchor is the image/snapshot
# you build ONCE and fork for every candidate (per contract §2/§5). For a stronger base pin,
# replace the tags below with python@sha256:<digest> and record it.
FROM python:3.11-alpine AS src
ARG VAMPI_SHA=f16052dce83f05847133ec98f01c5193a41de7d8
RUN apk --no-cache add git
RUN git clone https://github.com/erev0s/VAmPI.git /vampi \
 && cd /vampi \
 && git checkout "$VAMPI_SHA" \
 && git rev-parse HEAD > /vampi/.pinned_sha

FROM python:3.11-alpine
RUN apk --no-cache add bash g++ curl
COPY --from=src /vampi /vampi
# Fail the build if the pinned source doesn't match the recorded baseline hashes.
COPY baseline.sha256 /vampi/.baseline.sha256
WORKDIR /vampi
RUN sha256sum -c .baseline.sha256
RUN pip install --no-cache-dir -r requirements.txt
ENV vulnerable=1
ENV tokentimetolive=300
EXPOSE 5000
ENTRYPOINT ["python"]
CMD ["app.py"]
