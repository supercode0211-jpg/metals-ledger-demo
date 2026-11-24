# Metals Ledger

Gold, silver and platinum holdings where every gram on screen is explained by a ledger.
Deposits and withdrawals wait for admin approval, and a pending withdrawal holds its grams so
they can't be spent twice while it waits.

Stack: Express 5, Mongoose 9 and Zod 4 on the API; Next.js 16, React 19 and Tailwind 4 on the web side.

## Run it

Needs Node 20+.

```bash
npm install
npm run dev:api    # API on http://localhost:4000
npm run dev:web    # UI on http://localhost:3000
npm test           # API tests
```

Without `MONGO_URI` the API starts a throwaway single-node MongoDB replica set and seeds a few
accounts (the first run downloads a MongoDB binary, so give it a minute). Set `MONGO_URI` to use a
real database; it has to be a replica set because balances are written in transactions. Atlas
clusters are.

Demo accounts, password `demo1234`:

| Account | What it shows |
|---|---|
| `maya@demo.local` | holder with all three metals, one withdrawal and one redemption waiting |
| `omar@demo.local` | holder with a deposit waiting |
| `admin@demo.local` | approval queue, reconciliation, proof of reserve |

## The money rules

|                     | available | held    | ledger entry     |
|---------------------|-----------|---------|------------------|
| deposit created     |           |         |                  |
| deposit approved    | +amount   |         | `deposit_credit` |
| deposit rejected    |           |         |                  |
| withdrawal created  | -amount   | +amount | `hold`           |
| withdrawal approved |           | -amount | `settle`         |
| withdrawal rejected | +amount   | -amount | `release`        |

A redemption is a withdrawal that ends in physical delivery, so it follows the withdrawal rows.
Total is always `available + held`.

## Why the balances can be trusted

- **No floats.** Amounts are whole milligrams in the database and in every calculation. Grams only
  exist at the edges, as strings like `"12.500"`. The API refuses `12.5` as a number and refuses
  anything with more than three decimals instead of rounding it.
- **Balance and ledger move together.** Every balance change is one MongoDB transaction that
  updates the balance and appends the ledger entry explaining it. Either both happen or neither does.
- **The hold can't be raced.** Creating a withdrawal is a single conditional update: move the
  amount from available to held, only if available is at least the amount. Ten parallel
  withdrawals against the same balance can't overdraw it (there's a test for exactly that).
- **A request is decided once.** Approve and reject only match a request that is still `pending`,
  so a double click or two admins at the same time can't settle it twice. A unique index on
  `(request, kind)` in the ledger backs that up.
- **Retries don't duplicate.** `POST /api/requests` needs an `Idempotency-Key`. Sending the same
  call again returns the original request; reusing the key for a different request is refused.
- **The database has the last word.** A collection validator in MongoDB rejects a negative or
  fractional balance, whatever code (or hand-typed shell fix) tries to write it.
- **The ledger is append-only.** Update and delete are blocked on the model. A correction would be
  a new entry.
- **Reconciliation.** `GET /api/admin/reconciliation` re-derives every balance from the ledger and
  from the open requests, in one snapshot, and lists any difference. It never fixes anything on its
  own: a mismatch means something wrote outside the ledger service, and a person should look.
- **Accounts are closed, not deleted.** An account that holds metal or has a request waiting can't
  be closed at all, and closed accounts keep their history.
- **Four eyes.** An admin can't approve or reject their own request.

## Proof of reserve

`GET /api/proof-of-reserve` returns the side we actually know: total grams owed to holders, per
metal, straight from the balances. Reserves and coverage stay `null` with status
`awaiting_provider` until a reserve provider is connected. There's no ratio and no "verified" until
there is something real to compare against, and when there is, the comparison is per metal.

## API

All responses are `{ success, data }`; errors are `{ success: false, code, message }`.

| Method | Path | Who | |
|---|---|---|---|
| POST | `/user/login` | anyone | returns a token |
| GET | `/user/me` | signed in | |
| GET | `/api/holdings` | holder | available / held / total per metal |
| POST | `/api/requests` | holder | deposit, withdrawal or redemption (`Idempotency-Key` header) |
| GET | `/api/requests` | holder | own requests, newest first, `?status=&type=&limit=&before=` |
| GET | `/api/ledger` | holder | own ledger entries, newest first |
| GET | `/api/proof-of-reserve` | signed in | liabilities per metal |
| GET | `/api/admin/requests` | admin | queue, `?status=pending` (default, oldest first) |
| POST | `/api/admin/requests/:id/approve` | admin | |
| POST | `/api/admin/requests/:id/reject` | admin | body `{ reason }` |
| GET | `/api/admin/reconciliation` | admin | |
| DELETE | `/api/admin/users/:id` | admin | closes the account if it's empty |

```bash
curl -X POST localhost:4000/api/requests \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: 6f1c2e9a-withdraw-1" \
  -H "Content-Type: application/json" \
  -d '{"type":"withdrawal","metal":"gold","grams":"20.5"}'
```

## Tests

`npm test` runs against a real (in-memory) MongoDB replica set, not mocks, because the interesting
failures here are transactions and races:

- deposits stay pending until approved; rejected ones move nothing
- withdrawals hold on create, settle on approve, release on reject; redemptions behave the same
- a refused withdrawal leaves no half-written request or hold behind
- 10 parallel withdrawals of 30 g against 100 g: exactly 3 go through
- approve and reject racing on the same request: exactly one wins
- same idempotency key twice, sequentially and at the same moment: one request, held once
- the ledger refuses edits and deletes; MongoDB refuses negative or fractional balances
- 150 random operations across three holders and three metals reconcile cleanly, and a balance
  edited by hand afterwards is caught
- the HTTP layer: auth, roles, input validation, and the full holder path end to end

## Layout

```
api/
  src/
    models/          user, balance, request, ledger entry
    services/
      ledger.ts      every write to a balance happens here
      reconciliation.ts
      accounts.ts    closing accounts
    routes/          thin: validate input, call a service, shape the response
    lib/grams.ts     grams <-> milligrams
  test/
web/
  app/               sign in, holdings, admin
  lib/api.ts         typed client; every response is checked with zod
```

## Left out on purpose

- Auth is a minimal Bearer JWT. Routes only rely on `req.user`, so an existing cookie-based
  `isAuthenticatedUser` drops in without touching the ledger.
- No payment or custody provider: deposits are confirmed by an admin, which matches running on an
  internal ledger first.
- Helmet, CORS and rate limiting belong in the host app and aren't repeated here.
- Prices and valuations. This is about grams; pricing sits on top.
