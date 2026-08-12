import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { TodoRepository } from '../src/repository/TodoRepository';
import { STATUS_COMPLETED, STATUS_PENDING } from '../src/model/TodoItem';

/**
 * Integration tests against a REAL local DynamoDB instance (DynamoDB Local
 * via Docker Compose) - not mocked. This is intentional: it catches things
 * a mocked DynamoDBClient never would (wrong attribute names, bad
 * ConditionExpressions, marshalling bugs).
 *
 * Prerequisites to run:
 *   1. docker compose up -d
 *   2. DYNAMODB_ENDPOINT_URL=http://localhost:8000 npm test
 *
 * A fresh table named "todos-test" is created and dropped for this suite
 * so tests never collide with data you're poking at manually in the
 * "todos" table during a demo.
 */

const TABLE_NAME = 'todos-test';
const ENDPOINT = process.env.DYNAMODB_ENDPOINT_URL || 'http://localhost:8000';

const client = new DynamoDBClient({
  endpoint: ENDPOINT,
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
});
const doc = DynamoDBDocumentClient.from(client);
let repository: TodoRepository;

beforeAll(async () => {
  await createTableIfNotExists();
  repository = new TodoRepository(client, TABLE_NAME);
});

afterAll(async () => {
  await client.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
  client.destroy();
});

afterEach(async () => {
  // Cheap isolation between tests: scan + delete everything in the test table.
  const scan = await doc.send(new ScanCommand({ TableName: TABLE_NAME }));
  for (const item of scan.Items ?? []) {
    await doc.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { id: item.id } }));
  }
});

test('creates an item with generated fields', async () => {
  const created = await repository.create('Write tests', 'Cover all CRUD ops');

  expect(created.id).toBeTruthy();
  expect(created.title).toBe('Write tests');
  expect(created.description).toBe('Cover all CRUD ops');
  expect(created.status).toBe(STATUS_PENDING);
  expect(created.createdAt).toBe(created.updatedAt);
});

test('rejects a blank title on create', async () => {
  await expect(repository.create('   ', 'desc')).rejects.toMatchObject({ statusCode: 400 });
});

test('rejects an undefined title on create', async () => {
  await expect(repository.create(undefined, 'desc')).rejects.toMatchObject({ statusCode: 400 });
});

test('lists all items', async () => {
  await repository.create('Item A', undefined);
  await repository.create('Item B', undefined);

  const items = await repository.listAll();

  expect(items).toHaveLength(2);
});

test('list returns an empty array when the table is empty', async () => {
  const items = await repository.listAll();
  expect(items).toHaveLength(0);
});

test('finds an item by id', async () => {
  const created = await repository.create('Find me', undefined);

  const found = await repository.getByIdOrThrow(created.id);

  expect(found.id).toBe(created.id);
  expect(found.title).toBe('Find me');
});

test('throws a 404 ApiError for a missing id', async () => {
  await expect(repository.getByIdOrThrow('does-not-exist')).rejects.toMatchObject({ statusCode: 404 });
});

test('updates title and description', async () => {
  const created = await repository.create('Original', 'Original desc');
  await new Promise((r) => setTimeout(r, 5)); // ensure updatedAt strictly increases

  const updated = await repository.update(created.id, {
    title: 'Updated',
    description: 'Updated desc'
  });

  expect(updated.title).toBe('Updated');
  expect(updated.description).toBe('Updated desc');
  expect(updated.createdAt).toBe(created.createdAt); // createdAt must not change on update
  expect(updated.updatedAt).not.toBe(created.updatedAt); // updatedAt must change on update
});

test('update rejects a blank title', async () => {
  const created = await repository.create('Keep me', undefined);
  await expect(repository.update(created.id, { title: '' })).rejects.toMatchObject({ statusCode: 400 });
});

test('update rejects an invalid status', async () => {
  const created = await repository.create('Keep me', undefined);
  await expect(
    repository.update(created.id, { status: 'not-a-real-status' })
  ).rejects.toMatchObject({ statusCode: 400 });
});

test('update on a missing item throws 404', async () => {
  await expect(
    repository.update('does-not-exist', { title: 'New title' })
  ).rejects.toMatchObject({ statusCode: 404 });
});

test('marks an item completed', async () => {
  const created = await repository.create('Finish me', undefined);

  const completed = await repository.markCompleted(created.id);

  expect(completed.status).toBe(STATUS_COMPLETED);
});

test('deletes an item', async () => {
  const created = await repository.create('Delete me', undefined);

  await repository.delete(created.id);

  await expect(repository.findById(created.id)).resolves.toBeUndefined();
});

test('delete on a missing item throws 404', async () => {
  await expect(repository.delete('does-not-exist')).rejects.toMatchObject({ statusCode: 404 });
});

async function createTableIfNotExists(): Promise<void> {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    return; // already exists (e.g. re-running tests without a container restart)
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }

  await client.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST'
    })
  );
}
