/**
 * Correctly fixed candidate: Mahmoud's fix rule at the marked spot.
 * Same tenant AND (owner OR admin). Admin reads any record in its OWN tenant only.
 * Expected verdict: PASS.
 */
import { createCandidateApp, listen } from "./recordshop.js";

const app = createCandidateApp(
  (record, me) => record.tenantId === me.tenantId && (record.ownerId === me.userId || me.role === "admin"),
);

listen(app, "fixed", 3001);
