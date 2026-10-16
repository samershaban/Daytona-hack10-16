# @restorelab/contracts

Shared TypeScript types for every RestoreLab component. `RunStatus`, `Finding`, `AgentMessage`, `Candidate` and `Verdict` are the shared contracts from `BUILD_PLAN.md`. The rest (`Run`, `Approval`, `Evidence`, `RunEvent`, `Report`, request bodies) describe the HTTP API in `packages/api`.

```ts
import type { Finding, AgentMessage, Verdict } from "@restorelab/contracts";
```

Types only, no runtime code. Change them only by agreement, because all four workstreams compile against them.
