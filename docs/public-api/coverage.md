# Operation coverage

Public interfaces remain under construction. No operation is shipped merely because its existing source is listed here.

| Existing source | Operations | REST/MCP status |
| --- | --- | --- |
| `app/api/account-identity/route.ts` | GET, PATCH | pending |
| `app/api/binder-appearance/artwork/route.ts` | GET | pending |
| `app/api/binder-appearance/route.ts` | GET, PUT | pending |
| `app/api/binder-appearance/upload/route.ts` | POST | pending |
| `app/api/binder-identity/route.ts` | GET, PATCH | pending |
| `app/api/binder-share/route.ts` | GET, POST, DELETE | pending |
| `app/api/binders/route.ts` | GET, POST, PATCH, DELETE | pending |
| `app/api/card-image-proxy/route.ts` | GET | pending |
| `app/api/card-price-checks/route.ts` | GET, POST | pending |
| `app/api/card-prices/refresh/route.ts` | GET, POST | pending |
| `app/api/card-prices/route.ts` | POST, GET | pending |
| `app/api/collection/route.ts` | POST, PATCH, DELETE | pending |
| `app/api/collection-analytics/route.ts` | GET | pending |
| `app/api/collection-import/resolve/route.ts` | POST | pending |
| `app/api/comparison-jobs/route.ts` | GET, POST | pending |
| `app/api/ebay/listings/route.ts` | GET | pending |
| `app/api/settings/route.ts` | GET, PUT | pending |
| `app/api/tcg-card-search/route.ts` | GET | pending |
| `app/api/tcg-illustrators/route.ts` | GET | pending |
| `app/api/tcg-set-slots/route.ts` | GET | pending |
| `app/api/tcgdex-cache/route.ts` | GET | pending |
| `hooks/use-partner.ts` | invites, accept, reject, disconnect | pending |
| `hooks/use-show-purchase-sync.ts` | read, add, undo | pending |
| `lib/deal-check.ts` | deal evaluation | pending |

Website-only: billing, account deletion, credentials, push-device enrollment. Device-only: camera capture, wake lock, offline storage/queues.
