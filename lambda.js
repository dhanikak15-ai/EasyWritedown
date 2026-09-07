const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET || 'easywritedown-files-392087426683';
const TABLE = process.env.DYNAMODB_TABLE || 'easywritedown-pages';
const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

const s3Client = new S3Client({ region: REGION });
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  // Support both Lambda Function URL (event.requestContext.http) and API Gateway
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const rawPath = event.rawPath || event.path || '';

  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  // Route 1: GET /api/page
  if (rawPath.endsWith('/page') && method === 'GET') {
    try {
      const query = event.queryStringParameters || {};
      const rawName = query.name;
      if (!rawName) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing page name query parameter' })
        };
      }

      const cleanSlug = rawName.toLowerCase().trim().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

      const result = await ddbClient.send(new GetCommand({
        TableName: TABLE,
        Key: { pageName: cleanSlug }
      }));

      if (!result.Item) {
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ exists: false, pageName: cleanSlug })
        };
      }

      const item = result.Item;
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET,
        Key: item.s3Key
      });

      const fileUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          exists: true,
          pageName: item.pageName,
          fileUrl,
          fileName: item.fileName,
          fileType: item.fileType,
          fileSize: item.fileSize,
          createdAt: item.createdAt
        })
      };
    } catch (err) {
      console.error('Error in /api/page:', err);
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: err.message || 'Internal server error' })
      };
    }
  }

  // Route 2: POST /api/upload-request
  if (rawPath.endsWith('/upload-request') && method === 'POST') {
    try {
      let bodyStr = event.body;
      if (event.isBase64Encoded && bodyStr) {
        bodyStr = Buffer.from(bodyStr, 'base64').toString('utf-8');
      }

      const parsed = typeof bodyStr === 'string' ? JSON.parse(bodyStr || '{}') : (bodyStr || {});
      const { pageName, fileName, fileType, fileSize, contentType } = parsed;

      if (!pageName || !fileName || !fileType) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing required fields: pageName, fileName, fileType' })
        };
      }

      const cleanSlug = pageName.toLowerCase().trim().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (!cleanSlug) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Invalid page name' })
        };
      }

      if (fileSize && fileSize > MAX_SIZE) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'File size exceeds 100 MB limit' })
        };
      }

      const cleanExt = fileType.toLowerCase().replace(/^\./, '');
      if (!['pdf', 'ppt', 'pptx'].includes(cleanExt)) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Only PDF and PowerPoint files are allowed' })
        };
      }

      const s3Key = `uploads/${cleanSlug}-${Date.now()}.${cleanExt}`;
      const detectedContentType = contentType || (cleanExt === 'pdf' ? 'application/pdf' : 'application/vnd.ms-powerpoint');

      const putCommand = new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        ContentType: detectedContentType
      });

      const uploadUrl = await getSignedUrl(s3Client, putCommand, { expiresIn: 900 });

      const item = {
        pageName: cleanSlug,
        fileName,
        fileType: cleanExt,
        fileSize: fileSize || 0,
        s3Key,
        contentType: detectedContentType,
        createdAt: new Date().toISOString()
      };

      await ddbClient.send(new PutCommand({
        TableName: TABLE,
        Item: item
      }));

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          pageName: cleanSlug,
          uploadUrl,
          s3Key,
          item
        })
      };
    } catch (err) {
      console.error('Error in /api/upload-request:', err);
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: err.message || 'Internal server error' })
      };
    }
  }

  return {
    statusCode: 404,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: 'Not found' })
  };
};
