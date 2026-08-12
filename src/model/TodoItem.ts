export const STATUS_PENDING = 'pending';
export const STATUS_COMPLETED = 'completed';

export type TodoStatus = typeof STATUS_PENDING | typeof STATUS_COMPLETED;

/**
 * A single To-Do item as stored in DynamoDB / returned by the API.
 * Field names match the assignment brief: id, title, description, status,
 * createdAt, updatedAt.
 */
export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

/** Fields a caller may update via PATCH/PUT. All optional - partial update. */
export interface TodoUpdateInput {
  title?: string;
  description?: string;
  status?: string;
}
