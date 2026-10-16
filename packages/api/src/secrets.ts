// Credentials must never enter shared findings or agent messages (BUILD_PLAN.md). Findings and
// messages containing one are rejected; raw evidence is stored with credentials redacted.

const PATTERNS: [name: string, re: RegExp][] = [
  // Header patterns first so a header is redacted as one unit before the bare-token patterns run.
  // Anchored to line start so prose like "Broken Object Level Authorization: ..." is not a header.
  ["authorization header", /^[ \t]*(proxy-)?authorization[ \t]*:[^\r\n]*/gim],
  ["cookie header", /^[ \t]*(set-)?cookie[ \t]*:[^\r\n]*/gim],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi],
  ["AWS access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ["API key", /\b(sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|xox[abp]-[A-Za-z0-9-]{10,})\b/g],
  ["credential assignment", /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|token)\b["']?\s*[:=]\s*["']?[^\s"',;]{4,}/gi],
];

/** Name of the first kind of credential found, if any. */
export function findSecret(text: string): string | undefined {
  return PATTERNS.find(([, re]) => { re.lastIndex = 0; return re.test(text); })?.[0];
}

export function redact(text: string): { text: string; redactions: number } {
  let redactions = 0;
  for (const [name, re] of PATTERNS)
    text = text.replace(re, () => { redactions++; return `[REDACTED ${name}]`; });
  return { text, redactions };
}
