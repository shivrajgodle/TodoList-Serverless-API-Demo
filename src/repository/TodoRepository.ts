import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { TodoItem, TodoUpdateInput, STATUS_PENDING, STATUS_COMPLETED } from '../model/TodoItem';
import { ApiError } from '../util/ApiError';

/**
 * All DynamoDB access lives here. Nothing above this layer (the handler)
 * imports from @aws-sdk/* directly - keeps request/response plumbing
 * decoupled from the storage engine and makes the handler easy to unit
 * test with a fake repository if needed.
 *
 * Table schema (single-table, single-item-type - intentionally simple):
 *   Partition key: id (String)
 *   Attributes: title, description, status, createdAt, updatedAt
 */
export class TodoRepository {
  private readonly doc: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(client: DynamoDBClient, tableName: string) {
    this.doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true }
    });
    this.tableName = tableName;
  }

  async create(title: string | undefined, description: string | undefined): Promise<TodoItem> {
    if (!title || !title.trim()) {
      throw ApiError.badRequest('title is required and cannot be blank');
    }

    const now = new Date().toISOString();
    const item: TodoItem = {
      id: uuidv4(),
      title: title.trim(),
      description,
      status: STATUS_PENDING,
      createdAt: now,
      updatedAt: now
    };

    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        // Defensive: UUIDs shouldn't collide, but this guarantees create()
        // never silently overwrites an existing item.
        ConditionExpression: 'attribute_not_exists(id)'
      })
    );

    return item;
  }

  async listAll(): Promise<TodoItem[]> {
    // NOTE: Scan does not paginate here (no handling of LastEvaluatedKey), so
    // this will silently truncate past ~1MB of table data. Fine for a
    // demo-sized table - flagged as a known limitation in the README.
    const response = await this.doc.send(new ScanCommand({ TableName: this.tableName }));
    return (response.Items ?? []) as TodoItem[];
  }

  async findById(id: string): Promise<TodoItem | undefined> {
    const response = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { id } })
    );
    return response.Item as TodoItem | undefined;
  }

  async getByIdOrThrow(id: string): Promise<TodoItem> {
    const item = await this.findById(id);
    if (!item) {
      throw ApiError.notFound(`No todo item found with id ${id}`);
    }
    return item;
  }

  /** Partial update: only fields present on `updates` are changed. */
  async update(id: string, updates: TodoUpdateInput): Promise<TodoItem> {
    // Confirm it exists first so we return a clean 404 instead of letting
    // DynamoDB's ConditionalCheckFailedException leak through.
    await this.getByIdOrThrow(id);

    if (updates.title !== undefined && !updates.title.trim()) {
      throw ApiError.badRequest('title cannot be blank');
    }
    if (
      updates.status !== undefined &&
      updates.status !== STATUS_PENDING &&
      updates.status !== STATUS_COMPLETED
    ) {
      throw ApiError.badRequest(`status must be one of: ${STATUS_PENDING}, ${STATUS_COMPLETED}`);
    }

    const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = { ':updatedAt': new Date().toISOString() };
    const setClauses: string[] = ['#updatedAt = :updatedAt'];

    (['title', 'description', 'status'] as const).forEach((field) => {
      if (updates[field] !== undefined) {
        names[`#${field}`] = field;
        values[`:${field}`] = updates[field];
        setClauses.push(`#${field} = :${field}`);
      }
    });

    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { id },
          UpdateExpression: `SET ${setClauses.join(', ')}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ConditionExpression: 'attribute_exists(id)'
        })
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        // Race: item was deleted between the getByIdOrThrow check above and
        // this update. Map to the same 404 a caller would expect.
        throw ApiError.notFound(`No todo item found with id ${id}`);
      }
      throw err;
    }

    return this.getByIdOrThrow(id);
  }

  async markCompleted(id: string): Promise<TodoItem> {
    return this.update(id, { status: STATUS_COMPLETED });
  }

  async delete(id: string): Promise<void> {
    // Confirm existence first for a clean 404 rather than a silent no-op delete.
    await this.getByIdOrThrow(id);

    await this.doc.send(new DeleteCommand({ TableName: this.tableName, Key: { id } }));
  }
}
