import type { QuotaStatus } from "../lib/types";

// Shared by CompanySearch.tsx and ReturnCalculator.tsx -- both pages spend
// real Tapetide quota (a company search on one, picking a stock to
// personalize on the other), and both read the exact same `quota` state
// lifted to App.tsx, so this one component is what keeps them showing an
// identical, in-sync number rather than two independent implementations
// that could drift apart.
//
// A local estimate, not Tapetide's own server-side counter (see
// QuotaStatus/get_quota_status) -- worded as "~" to avoid implying more
// precision than we actually have.
export default function QuotaCounter({ quota }: { quota: QuotaStatus }) {
  const searchesLeft = quota.tapetide_searches_remaining_estimate;
  const tone = searchesLeft <= 0 ? "bad" : searchesLeft <= 2 ? "warning" : "good";
  return (
    <span
      className={`search-quota-counter ${tone}`}
      role="status"
      title={`~${quota.tapetide_calls_remaining_estimate} Tapetide calls left today (${quota.tapetide_calls_used_today} used)`}
    >
      ~{searchesLeft} search{searchesLeft === 1 ? "" : "es"} left today
    </span>
  );
}
