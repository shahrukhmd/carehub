import type { ClearinghouseAdapter } from "./types";
import { mockClearinghouseAdapter } from "./mockAdapter";

export * from "./types";

// Single seam for swapping in a real clearinghouse (Office Ally, Availity,
// Change Healthcare, ...). Everything else in the app talks to this
// interface only, so a real integration is a one-file change here.
export function getClearinghouseAdapter(): ClearinghouseAdapter {
  return mockClearinghouseAdapter;
}
