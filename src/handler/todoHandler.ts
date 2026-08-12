import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { TodoRepository } from '../repository/TodoRepository';
import { ApiError } from '../util/ApiError';
import { TodoUpdateInput } from '../model/TodoItem';

/**
 * Single Lambda-compatible handler for the whole To-Do API.
 *
 * WHY one handler for everything: the brief asks for a single Lambda
 * handler / single table, no layered abstractions. Routing on
 * (httpMethod, path) below is deliberately simple string matching rather
 * than a routing framework - appropriate for 6 operations, would NOT
 * scale well past ~10-15 routes.
 *
 * This function matches the AWS Lambda + API Gateway proxy-integration
 * contract (APIGatewayProxyEvent -> APIGatewayProxyResult) exactly, so
 * it's deployable to real Lambda with zero code changes - only
 * localServer.ts (used for local dev) sits outside that deployable
 * surface.
 */

function buildRepositoryFromEnv(): TodoRepository {
  const tableName = process.env.TODO_TABLE_NAME || 'todos';
  const endpoint = process.env.DYNAMODB_ENDPOINT_URL; // e.g. http://localhost:8000, unset in real AWS

  const client = new DynamoDBClient({
    ...(endpoint
      ? {
          // Local mode (DynamoDB Local): it ignores credential validity but the
          // SDK still needs a region + credentials present to build a client.
          // Real Lambda never hits this branch - DYNAMODB_ENDPOINT_URL is unset
          // there, and Lambda's execution environment provides region +
          // credentials via its own default chain.
          endpoint,
          region: process.env.AWS_REGION || 'us-east-1',
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
        }
      : {})
  });

  return new TodoRepository(client, tableName);
}

// Built once per Lambda execution environment (cold start), reused across
// warm invocations - this is standard Lambda practice for connection reuse.
let repository: TodoRepository | undefined;

function getRepository(): TodoRepository {
  if (!repository) {
    repository = buildRepositoryFromEnv();
  }
  return repository;
}

/** Allows localServer.ts and tests to inject a pre-configured repository. */
export function createHandler(repo: TodoRepository) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    return dispatch(event, repo);
  };
}

export async function handler(event: APIGatewayProxyEvent, _context: Context): Promise<APIGatewayProxyResult> {
  return dispatch(event, getRepository());
}

async function dispatch(event: APIGatewayProxyEvent, repo: TodoRepository): Promise<APIGatewayProxyResult> {
  const method = (event.httpMethod || '').toUpperCase();
  const path = normalizePath(event.path);
  console.log(JSON.stringify({ msg: 'Request received', method, path }));

  try {
    const response = await route(method, path, event, repo);
    console.log(JSON.stringify({ msg: 'Request completed', method, path, statusCode: response.statusCode }));
    return response;
  } catch (err) {
    if (err instanceof ApiError) {
      console.warn(JSON.stringify({ msg: 'Request failed', method, path, statusCode: err.statusCode, error: err.message }));
      return jsonResponse(err.statusCode, { error: err.message });
    }
    // Deliberately do not leak err.message / stack trace to the caller -
    // internal exception details (DynamoDB errors, bugs, etc.) could expose
    // implementation info. Full detail goes to the log only.
    console.error(JSON.stringify({ msg: 'Unexpected error', method, path, error: String(err) }));
    return jsonResponse(500, { error: 'Internal server error' });
  }
}

async function route(
  method: string,
  path: string,
  event: APIGatewayProxyEvent,
  repo: TodoRepository
): Promise<APIGatewayProxyResult> {
  if (path !== '/todos' && !path.startsWith('/todos/')) {
    throw ApiError.notFound(`Unknown route: ${method} ${path}`);
  }

  const segments = path.split('/'); // '' , 'todos', [id], [action]
  const isCollection = segments.length === 2; // /todos
  const isItem = segments.length === 3; // /todos/{id}

  if (isCollection && method === 'POST') {
    return handleCreate(event, repo);
  }
  if (isCollection && method === 'GET') {
    return handleList(repo);
  }
  if (isItem && method === 'GET') {
    return handleGet(segments[2], repo);
  }
  if (isItem && (method === 'PUT' || method === 'PATCH')) {
    return handleUpdate(segments[2], event, repo);
  }
  if (isItem && method === 'DELETE') {
    return handleDelete(segments[2], repo);
  }
  // Convenience endpoint: POST /todos/{id}/complete
  if (segments.length === 4 && segments[3] === 'complete' && method === 'POST') {
    return handleComplete(segments[2], repo);
  }

  throw ApiError.notFound(`Unknown route: ${method} ${path}`);
}

async function handleCreate(event: APIGatewayProxyEvent, repo: TodoRepository): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  const created = await repo.create(body.title as string | undefined, body.description as string | undefined);
  return jsonResponse(201, created);
}

async function handleList(repo: TodoRepository): Promise<APIGatewayProxyResult> {
  const items = await repo.listAll();
  return jsonResponse(200, { items, count: items.length });
}

async function handleGet(id: string, repo: TodoRepository): Promise<APIGatewayProxyResult> {
  const item = await repo.getByIdOrThrow(id);
  return jsonResponse(200, item);
}

async function handleUpdate(
  id: string,
  event: APIGatewayProxyEvent,
  repo: TodoRepository
): Promise<APIGatewayProxyResult> {
  const body = parseBody(event) as TodoUpdateInput;
  if (Object.keys(body).length === 0) {
    throw ApiError.badRequest('Request body must include at least one of: title, description, status');
  }
  const updated = await repo.update(id, body);
  return jsonResponse(200, updated);
}

async function handleComplete(id: string, repo: TodoRepository): Promise<APIGatewayProxyResult> {
  const updated = await repo.markCompleted(id);
  return jsonResponse(200, updated);
}

async function handleDelete(id: string, repo: TodoRepository): Promise<APIGatewayProxyResult> {
  await repo.delete(id);
  return jsonResponse(204, null);
}

// ---- helpers ----

function normalizePath(rawPath: string | null | undefined): string {
  if (!rawPath) return '/';
  let p = rawPath;
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p;
}

function parseBody(event: APIGatewayProxyEvent): Record<string, unknown> {
  if (!event.body) return {};
  try {
    const parsed = JSON.parse(event.body);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw ApiError.badRequest('Request body is not valid JSON');
  }
}

function jsonResponse(statusCode: number, payload: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: payload === null || payload === undefined ? '' : JSON.stringify(payload)
  };
}
