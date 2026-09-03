const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET || 'easywritedown-files-392087426683';
const TABLE = process.env.DYNAMODB_TABLE || 'easywritedown-pages';

const s3Client = new S3Client({ region: REGION });
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawName = (req.query && req.query.name) || (req.url && new URL(req.url, 'http://localhost').searchParams.get('name'));
    if (!rawName) {
      return res.status(400).json({ error: 'Missing page name query parameter' });
    }

    const cleanSlug = rawName.toLowerCase().trim().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

    const result = await ddbClient.send(new GetCommand({
      TableName: TABLE,
      Key: { pageName: cleanSlug }
    }));

    if (!result.Item) {
      return res.status(200).json({ exists: false, pageName: cleanSlug });
    }

    const item = result.Item;

    // Generate pre-signed S3 GET URL (valid for 1 hour)
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET,
      Key: item.s3Key
    });

    const fileUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });

    return res.status(200).json({
      exists: true,
      pageName: item.pageName,
      fileUrl,
      fileName: item.fileName,
      fileType: item.fileType,
      fileSize: item.fileSize,
      createdAt: item.createdAt
    });
  } catch (err) {
    console.error('Error in get-page:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
