const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET || 'easywritedown-files-392087426683';
const TABLE = process.env.DYNAMODB_TABLE || 'easywritedown-pages';

const s3Client = new S3Client({ region: REGION });
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }

    const { pageName, fileName, fileType, fileSize, contentType } = body || {};

    if (!pageName || !fileName || !fileType) {
      return res.status(400).json({ error: 'Missing required fields: pageName, fileName, fileType' });
    }

    const cleanSlug = pageName.toLowerCase().trim().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!cleanSlug) {
      return res.status(400).json({ error: 'Invalid page name' });
    }

    const MAX_SIZE = 10 * 1024 * 1024;
    if (fileSize && fileSize > MAX_SIZE) {
      return res.status(400).json({ error: 'File size exceeds 10 MB limit' });
    }

    const cleanExt = fileType.toLowerCase().replace(/^\./, '');
    if (!['pdf', 'ppt', 'pptx'].includes(cleanExt)) {
      return res.status(400).json({ error: 'Only PDF and PowerPoint files are allowed' });
    }

    const s3Key = `uploads/${cleanSlug}-${Date.now()}.${cleanExt}`;
    const detectedContentType = contentType || (cleanExt === 'pdf' ? 'application/pdf' : 'application/vnd.ms-powerpoint');

    const putCommand = new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      ContentType: detectedContentType,
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

    return res.status(200).json({
      success: true,
      pageName: cleanSlug,
      uploadUrl,
      s3Key,
      item
    });
  } catch (err) {
    console.error('Error in upload-request:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
