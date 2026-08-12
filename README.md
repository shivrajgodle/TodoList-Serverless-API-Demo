# To-Do API (TypeScript, Local-Only, Lambda-Style)

A small serverless-style REST API for managing to-do items, built as a
timeboxed (4-hour) AI-assisted development demo. **Local only** — no AWS
account, no deployment. The handler is written against the real AWS Lambda +
API Gateway proxy-integration contract (`APIGatewayProxyEvent ->
APIGatewayProxyResult`), so it's deployable as-is; only `localServer.ts`
exists purely for local dev and sits outside that deployable surface.

## Architecture

- **One Lambda-compatible handler** (`src/handler/todoHandler.ts`) routes
  all six operations by HTTP method + path.
- **One DynamoDB table** (`todos`), partition key `id` (String).
- **Local HTTP wrapper** (`src/localServer.ts`) uses only Node's built-in
  `http` module to translate raw HTTP into `APIGatewayProxyEvent` /
  `APIGatewayProxyResult` and calls the exact same `handler()` that would
  run in real Lambda. Chosen over `sam local start-api` to avoid depending
  on SAM CLI being pre-installed — see "Design decisions" below.
- **DynamoDB Local** runs in Docker via `docker-compose.yml`; the API
  itself runs on the host via `npm start` / `npm run dev`, not in Docker.

```
src/
  model/TodoItem.ts        - TodoItem / TodoUpdateInput types
  repository/TodoRepository.ts - all DynamoDB access (CRUD + validation)
  handler/todoHandler.ts   - Lambda-compatible routing + request handling
  util/ApiError.ts         - status-code-carrying error for clean error mapping
  localServer.ts           - local-only HTTP <-> Lambda event translation
scripts/
  create-table.ts          - table creation via AWS SDK directly (no AWS CLI needed)
test/
  todoApi.test.ts          - Jest integration tests against real local DynamoDB
```

## Prerequisites

- Node.js 18+
- Docker + Docker Compose (for DynamoDB Local only)

No AWS CLI needed — the table-creation script uses the AWS SDK directly.

## Setup & Run

```bash
# 1. Install dependencies
npm install

# 2. Start DynamoDB Local
docker compose up -d

# 3. Point everything at it for this shell session
export DYNAMODB_ENDPOINT_URL=http://localhost:8000

# 4. Create the table
npm run create-table

# 5. Run the API (default port 8080)
npm start
```

`export DYNAMODB_ENDPOINT_URL=...` only lasts for the current terminal
session — re-run it (or add it to your shell profile) in any new terminal
before running `npm run create-table` / `npm start` / `npm test`.

Verify it's up:

```bash
curl http://localhost:8080/todos
# {"items":[],"count":0}
```

For active development with auto-restart on file changes, use `npm run dev`
instead of `npm start` (uses `ts-node-dev`, skips the separate build step).

### Configuration (environment variables)

See `.env.example`. This project does not auto-load `.env` files — export
these directly in your shell (keeps config handling minimal for a 4-hour
demo; add `dotenv` yourself if you'd prefer that instead).

| Variable               | Default                | Purpose                                  |
|-------------------------|-------------------------|-------------------------------------------|
| `PORT`                  | `8080`                  | Local HTTP server port                    |
| `TODO_TABLE_NAME`       | `todos`                 | DynamoDB table name                       |
| `DYNAMODB_ENDPOINT_URL` | *(unset → real AWS)*    | Set to `http://localhost:8000` for local  |
| `AWS_REGION`            | `us-east-1`             | Only used in local mode                   |

## API Reference

| Method | Path                  | Description                          |
|--------|------------------------|----------------------------------------|
| POST   | `/todos`               | Create a to-do item                   |
| GET    | `/todos`               | List all to-do items                  |
| GET    | `/todos/{id}`          | Get one to-do item                    |
| PUT/PATCH | `/todos/{id}`       | Update a to-do item (partial update)  |
| POST   | `/todos/{id}/complete` | Mark a to-do item completed           |
| DELETE | `/todos/{id}`          | Delete a to-do item                   |

See `requests.http` (VS Code REST Client / JetBrains HTTP client),
`curl-examples.md`, or the Postman collection for a runnable example of
every operation, including expected error cases (400 on blank title, 404 on
unknown id).

## Tests

```bash
# DynamoDB Local must already be running (docker compose up -d)
export DYNAMODB_ENDPOINT_URL=http://localhost:8000
npm test
```

Tests run against a **real local DynamoDB table** (`todos-test`), created
and torn down automatically (`beforeAll`/`afterAll`) — not mocked, and kept
separate from the `todos` table you might be poking at manually during a
demo. Coverage: create (+ blank/undefined title validation), list (incl.
empty table), get by id (+ 404), update (+ blank title / invalid status
validation, + 404, + `updatedAt` changes while `createdAt` doesn't), mark
completed, delete (+ 404).

## Inspecting data in DynamoDB Local

```bash
aws dynamodb scan --endpoint-url http://localhost:8000 --table-name todos
```

(Needs the AWS CLI for this one command specifically — it's optional, only
for poking at data by hand. Everything the app itself needs runs without
it.) Or use [NoSQL Workbench](https://aws.amazon.com/dynamodb/nosql-workbench/)
pointed at `http://localhost:8000` for a GUI table browser.

## Cleanup / Teardown

```bash
# Stop the API: Ctrl+C in the terminal running `npm start` / `npm run dev`

# Stop and remove DynamoDB Local (data is in-memory, so this also wipes it)
docker compose down
```

## Design decisions

- **Local HTTP wrapper instead of SAM CLI**: SAM CLI needs its own install
  + Docker image pulls, which risks eating a meaningful chunk of a 4-hour
  budget if it isn't already set up. Node's built-in `http` module needs
  nothing beyond Node itself, and the translation layer is thin enough
  (~60 lines) that the handler code underneath is still genuinely
  Lambda-compatible, not a reimplementation.
- **`create-table.ts` instead of an AWS-CLI shell script**: avoids
  requiring a separate AWS CLI install for the one piece of setup that
  would otherwise need it.
- **API runs on the host, not in Docker**: only DynamoDB Local is
  containerized. Building a Node Docker image costs real time for no demo
  value here.
- **Scan for list-all**: fine at demo scale (few items). Does **not**
  paginate via `LastEvaluatedKey` — see Known Limitations.
- **`-inMemory` DynamoDB Local**: data resets on container restart. Traded
  deliberately for simplicity; flip to a mounted volume (commented out in
  `docker-compose.yml`) if you want persistence across restarts.
- **AWS SDK v3 (`@aws-sdk/client-dynamodb` + `lib-dynamodb`)** rather than
  v2: v3 is what AWS currently ships by default in the Node.js Lambda
  runtime, so this matches what a real deployment would actually use.

## Known limitations (explicitly out of scope per the brief)

- No authentication/authorization — anyone who can reach the port has full
  access.
- No pagination on `GET /todos` (`Scan` without `LastEvaluatedKey`
  handling) — would silently truncate past ~1MB of table data.
- No AWS deployment, CI/CD, monitoring, or multi-region support.
- CORS headers are not set. If you later serve this to a browser-based
  frontend on a different origin, you'll need to add
  `Access-Control-Allow-Origin` (scoped to a specific origin, not `*`) in
  `jsonResponse()` in `todoHandler.ts`.
- Error responses return `{"error": "..."}` with a client-safe message
  only; unexpected exceptions are logged with full detail server-side (see
  the `console.error` in `dispatch()`) but return a generic "Internal
  server error" to the caller — intentional, so internal errors never leak
  DynamoDB/SDK internals.

## Code review notes — what to check by hand, not just trust

Per the working-process request, here's what's worth a manual look before
relying on this in an interview/demo, roughly in order of risk:

1. **`TodoRepository.update()`'s dynamic `UpdateExpression` construction**
   (building `SET` clauses + `ExpressionAttributeNames`/`Values` from a
   partial object) — the single most AI-error-prone piece in this
   codebase. Verify by hand: PATCH only one field and confirm the others
   are untouched via `aws dynamodb scan`.
2. **`ConditionExpression: 'attribute_not_exists(id)')` on create, and
   `'attribute_exists(id)'` on update** — these prevent silent overwrites
   and turn "item vanished mid-request" into a clean 404 (caught explicitly
   via `ConditionalCheckFailedException` in `update()`) rather than a raw
   SDK exception leaking through.
3. **Dependency versions in `package.json`** — pinned with `^` (caret)
   ranges, which is normal for a Node project, but worth a
   `npm ls @aws-sdk/client-dynamodb` sanity check if anything behaves
   unexpectedly after a fresh `npm install` pulls a newer minor version
   than what was tested here.
4. **Status code choices** — 201 on create, 200 on read/update, 204 (no
   body) on delete, 400 on validation, 404 on missing resource, 500 on
   anything unexpected. Worth checking against whatever spec/rubric this
   needs to satisfy.
5. **`localServer.ts`'s `toApiGatewayEvent()`** — deliberately fills in
   only the fields the handler actually reads (`httpMethod`, `path`,
   `body`) and stubs the rest (`requestContext`, `headers`, etc.) with
   empty/placeholder values to satisfy the `APIGatewayProxyEvent` type.
   That's fine as long as the handler never starts reading those other
   fields — if you extend the handler later (e.g. to read query params or
   headers), extend this stub to actually populate them, or you'll get
   silent `undefined`s instead of a compile error.

## Validating this actually works (not just "looks right")

1. `npm install && docker compose up -d && export DYNAMODB_ENDPOINT_URL=http://localhost:8000 && npm run create-table && npm start` with no errors.
2. Run every request in `requests.http` / `curl-examples.md` / the Postman
   collection in order, including the deliberately-failing ones (blank
   title, unknown id, invalid status) — confirm status codes match what's
   documented above, not just "some response came back."
3. `npm test`, then re-run it a second time immediately — should still
   pass (checks the `afterEach` cleanup and idempotent table creation
   actually work, not just on a fresh DB).
4. Manually `aws dynamodb scan` after a PATCH and confirm `createdAt` is
   unchanged and only the fields you sent changed.
5. Kill DynamoDB Local (`docker compose down`) while the API is running,
   then hit an endpoint — confirm a clean 500 with a generic message in the
   response and the real connection error in the server log, not a stack
   trace leaked to the client.

## Security / code-quality risks worth knowing about (and why they're not fixed here)

Per the brief, none of these are addressed beyond what's noted — fixing
them properly would be over-engineering for a 4-hour local-only demo:

- **No auth** — anyone reaching the port can do anything. Fine for
  localhost-only; would need API Gateway authorizers / Cognito / an API
  key before this touched a network beyond your machine.
- **No rate limiting** — a single client could hammer the API. Not
  meaningful for a local demo.
- **Generic 500 messages are correct as-is**, not a gap — don't "fix" this
  by making error messages more descriptive; that's the wrong direction
  security-wise.
- **No CORS configuration** — see Known Limitations above; add explicitly
  scoped CORS only if/when a browser frontend is introduced.
