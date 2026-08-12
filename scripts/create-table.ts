/**
 * Creates the "todos" table against a local DynamoDB endpoint.
 *
 * WHY a TS script instead of an AWS-CLI shell script: the AWS CLI is an
 * extra install most Node developers won't already have (we hit exactly
 * this in the Java/Maven version of this project - `aws: command not
 * found`). This script only needs what's already in package.json.
 *
 * Run with: npm run create-table
 * (equivalent to: ts-node scripts/create-table.ts)
 */
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException
} from '@aws-sdk/client-dynamodb';

const ENDPOINT = process.env.DYNAMODB_ENDPOINT_URL || 'http://localhost:8000';
const TABLE_NAME = process.env.TODO_TABLE_NAME || 'todos';
const REGION = process.env.AWS_REGION || 'us-east-1';

const client = new DynamoDBClient({
  endpoint: ENDPOINT,
  region: REGION,
  // DynamoDB Local ignores credential validity but the SDK still requires
  // something present before it will build a client.
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
});

async function main(): Promise<void> {
  console.log(`Creating table '${TABLE_NAME}' at ${ENDPOINT} ...`);

  const exists = await tableExists();
  if (exists) {
    console.log(`Table '${TABLE_NAME}' already exists - nothing to do.`);
    return;
  }

  await client.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST'
    })
  );

  console.log(`Table '${TABLE_NAME}' is ready.`);
}

async function tableExists(): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    return true;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      return false;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error('Failed to create table:', err);
  process.exit(1);
});
