import * as http from 'http';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { TodoRepository } from './repository/TodoRepository';
import { createHandler } from './handler/todoHandler';

/**
 * Thin local HTTP wrapper around the Lambda handler, used ONLY for local
 * dev/demo.
 *
 * WHY this instead of SAM CLI: SAM CLI needs its own install + Docker
 * image pulls, which risks eating a meaningful chunk of a 4-hour budget if
 * it isn't already set up. Node's built-in `http` module needs nothing
 * beyond Node itself, and the translation layer below is thin enough
 * (~60 lines) that the handler code underneath is still genuinely
 * Lambda-compatible, not a reimplementation.
 *
 * This file is NOT part of the Lambda deployment artifact - it only
 * translates raw HTTP <-> APIGatewayProxyEvent/Result so the exact same
 * handler() code path that would run in real Lambda runs here too. There
 * is no handler logic in this file.
 */

const PORT = Number(process.env.PORT) || 8080;
const TABLE_NAME = process.env.TODO_TABLE_NAME || 'todos';
const ENDPOINT = process.env.DYNAMODB_ENDPOINT_URL;

const client = new DynamoDBClient({
  ...(ENDPOINT
    ? {
        endpoint: ENDPOINT,
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
      }
    : {})
});

const repository = new TodoRepository(client, TABLE_NAME);
const lambdaHandler = createHandler(repository);

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    void handleRequest(req, res, Buffer.concat(chunks).toString('utf-8'));
  });
});

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, rawBody: string): Promise<void> {
  try {
    const event = toApiGatewayEvent(req, rawBody);
    const result = await lambdaHandler(event);
    writeResponse(res, result);
  } catch (err) {
    console.error('Unhandled error in local server dispatch', err);
    const body = JSON.stringify({ error: 'Internal server error' });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(body);
  }
}

function toApiGatewayEvent(req: http.IncomingMessage, rawBody: string): APIGatewayProxyEvent {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  return {
    httpMethod: req.method || 'GET',
    path: url.pathname,
    body: rawBody.length > 0 ? rawBody : null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: ''
  };
}

function writeResponse(res: http.ServerResponse, result: APIGatewayProxyResult): void {
  const headers = result.headers ?? {};
  res.writeHead(result.statusCode, headers as http.OutgoingHttpHeaders);
  res.end(result.body ?? '');
}

server.listen(PORT, () => {
  console.log(`Local To-Do API listening on http://localhost:${PORT}`);
  console.log(`Try: curl http://localhost:${PORT}/todos`);
});
