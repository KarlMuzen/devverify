# Scheduling

The scheduler is deliberately pure and deterministic. It selects package names; the crawler remains responsible for enforcing the request budget before every HTTP attempt.

## Package-cap calculation

The Android Developer ID Status API budget is 950 attempts/day by default. A package can require up to two fingerprint checks, but registered packages can stop after the first successful REGISTERED result. The scheduler therefore uses a conservative average of **1.3 calls/package**:

`floor(950 / 1.3) = 730` packages/day.

This is an admission cap, not a permission to spend 730 × 2 requests. The shared `RequestBudget` in the crawler remains the hard limit.

## Priority

The base priority is:

`ageHours / recheckAfterHours[status]`

with the planned intervals:

| Status | Recheck interval |
| --- | ---: |
| `not_registered` | 24 h |
| `registered_other_key` | 24 h |
| `unknown` | 12 h |
| `registered` | 168 h |

The 3,800-record simulation exposed starvation when those intervals were used without additional weighting. The scheduler therefore applies explicit priority weights before sorting:

| Status | Weight | Reason |
| --- | ---: | --- |
| `not_registered` | 2 | Keep the largest population moving through the queue quickly. |
| `registered_other_key` | 1 | Normal aging. |
| `unknown` | 1 | Normal aging with the 12-hour base interval. |
| `registered` | 3 | Avoid long-tail starvation while retaining the 168-hour recheck interval. |

Final priority is:

`(ageHours / recheckAfterHours[status]) × priorityWeight[status]`

Ties are resolved by package name.

## Errors and removals

Records with `errorCount > 0` are held until the exponential backoff expires:

`min(24h, 2^errorCount h)`

The scheduler uses the most recent of `checkedAt` and `lastError.at` as the last attempt.

Removed records are never selected.

Never-checked records with no prior error are selected first, ordered by `firstSeenAt`, then package name.

## Simulation bound

The automated 60-day simulation uses 3,800 records, with 70% initially `not_registered`, a 950-call budget, and the default 730-package admission cap.

The test requires:

- every `not_registered` record is rechecked within 5 days;
- no record waits more than 30 days;
- identical inputs produce identical batches.

The implementation passes these bounds with the default weights above. The crawler must still stop issuing checks immediately when the hard request budget is exhausted.
