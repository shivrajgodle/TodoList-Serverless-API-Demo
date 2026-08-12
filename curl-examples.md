# cURL Examples

Base URL assumed: `http://localhost:8080`. Replace `<id>` with an id from a
create/list response.

```bash
# 1. Create
curl -i -X POST http://localhost:8080/todos \
  -H "Content-Type: application/json" \
  -d '{"title":"Buy groceries","description":"Milk, eggs, bread"}'

# 2. List all
curl -i http://localhost:8080/todos

# 3. Get one
curl -i http://localhost:8080/todos/<id>

# 4. Update (partial - title/description/status, any subset)
curl -i -X PATCH http://localhost:8080/todos/<id> \
  -H "Content-Type: application/json" \
  -d '{"title":"Buy groceries and cook dinner"}'

# 5. Mark completed
curl -i -X POST http://localhost:8080/todos/<id>/complete

# 6. Delete
curl -i -X DELETE http://localhost:8080/todos/<id>

# --- Error cases worth demoing ---

# Blank title -> 400
curl -i -X POST http://localhost:8080/todos \
  -H "Content-Type: application/json" \
  -d '{"title":"   "}'

# Unknown id -> 404
curl -i http://localhost:8080/todos/does-not-exist

# Invalid status on update -> 400
curl -i -X PATCH http://localhost:8080/todos/<id> \
  -H "Content-Type: application/json" \
  -d '{"status":"not-a-real-status"}'
```
