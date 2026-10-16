/**
 * Verifier configuration for VAmPI (erev0s/VAmPI).
 *
 * The verifier logs in FRESH each run with these credentials to get new
 * auth_tokens, so an expired token can never be mistaken for a working fix.
 * Synthetic identities and books match scripts/seed-vampi.sh. Each candidate
 * must be forked from a snapshot made after that script completes.
 */
import type { IdentityName } from "@restorelab/acceptance";

export type Identity = {
  username: string;
  /** Never logged or stored in evidence. */
  password: string;
  /** A book this user owns. */
  bookTitle: string;
  /** The secret the owner's book read must return (baseline ground truth). */
  expectedSecret: string;
};

export type VerifierConfig = {
  /** POST { username, password } → { auth_token }. */
  loginPath: string;
  /** GET book by title; ":title" is replaced. */
  bookPath: string;
  /** POST { book_title, secret } to create a book owned by the caller. */
  bookCreatePath: string;
  /** Basic liveness GET. */
  healthPath: string;
  /** A title that must not exist, for the 404 check. */
  missingTitle: string;
  identities: Record<IdentityName, Identity>;
};

export const VAMPI_CONFIG: VerifierConfig = {
  loginPath: "/users/v1/login",
  bookPath: "/books/v1/:title",
  bookCreatePath: "/books/v1",
  // VAmPI's root returns a hello/banner; used only as a non-5xx liveness probe.
  healthPath: "/",
  missingTitle: "restorelab-nonexistent-title-404-probe",
  identities: {
    userA: {
      username: "name1",
      password: "pass1",
      bookTitle: "restorelab-bola-book",
      expectedSecret: "S3CR3T-name1-canonical",
    },
    userB: {
      username: "name2",
      password: "pass2",
      bookTitle: "restorelab-name2-book",
      expectedSecret: "S3CR3T-name2-canonical",
    },
  },
};
