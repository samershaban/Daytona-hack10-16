/**
 * Over-restrictive candidate: "fixes" BOLA by letting only tenant admins read
 * records. Closes the exploit, but alice and bob can no longer read their own
 * records. Expected verdict: FAIL (own-tenant-allowed, bob-own-allowed).
 */
import { createCandidateApp, listen } from "./recordshop.js";

const app = createCandidateApp((record, me) => me.role === "admin" && record.tenantId === me.tenantId);

listen(app, "over-restrictive", 3002);
