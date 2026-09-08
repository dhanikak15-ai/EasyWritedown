# DONTCBOARD

> Publish PDFs and PowerPoint files to a memorable page name and share them through a clean, browser-based viewer.

DONTCBOARD is a small full-stack document publishing application built around an AWS serverless storage pattern. The browser handles the user experience, the API creates short-lived signed URLs, Amazon S3 stores document bytes, and Amazon DynamoDB stores the lookup metadata needed to find each document.

This project is also a practical first AWS cloud integration: it keeps the infrastructure understandable while using the same design principles used by larger cloud applications: least-privilege access, direct-to-object-storage uploads, durable metadata, and stateless API endpoints.

## Main Uses

- **Classroom Presentation Sharing** – Teachers upload PPT/PPTX files and share a simple link with students.
- **Clear Code Visibility** – Students can view slides clearly on their own devices instead of struggling to read the classroom board.
- **Independent Slide Navigation** – Students can move to previous or specific slides without affecting others.
- **Faster Teaching** – Teachers can continue teaching without waiting for everyone to finish copying code.
- **Coding Alongside Slides** – Students can keep the presentation beside VS Code, Ubuntu, VirtualBox, or other coding tools.
- **Easy Revision** – Students can open the same shared presentation from home and revisit previous code and concepts.
- **Simple, No-Login Access** – Students can open the classroom link directly without creating an account or managing files.
- **Less Storage Management** – Teachers upload once and share the presentation instead of repeatedly sending or managing files.
- **View-Only Learning** – Presentations are available in Restricted / Normal view options.

## Features

- Upload PDF, PPT, and PPTX files up to 100 MB.
- Choose a URL-friendly page name such as `quarterly-report`.
- Upload files directly from the browser to Amazon S3 with a presigned URL.
- Store page metadata in Amazon DynamoDB.
- Generate temporary, presigned download URLs when a page is viewed.
- Render PDFs with PDF.js and PowerPoint files through an embedded online viewer.
- Keep a browser-local IndexedDB copy as a fallback when cloud access is unavailable.
- Production hosting 100% on AWS (CloudFront CDN, S3, Lambda, DynamoDB) with custom domain support.
- Static XML sitemap, robots.txt, and JSON-LD structured data for Google Search Console indexing.
- Run locally with a small Node.js HTTP server or deploy to Vercel.

## AWS Architecture

```mermaid
flowchart LR
    User[Browser / Googlebot]
    DNS[Namecheap DNS\ndontcboard.me]
    CF[AWS CloudFront CDN\nFree ACM SSL Cert + 1 TB Free Bandwidth]
    S3Front[(Amazon S3\nFrontend: index.html, sitemap.xml, robots.txt)]
    Lambda[AWS Lambda Function\ndontcboard-api / lambda.js]
    S3Docs[(Amazon S3\nUploaded Documents)]
    DDB[(Amazon DynamoDB\nPage Metadata)]

    User --> DNS
    DNS --> CF
    CF -->|Default /* & SPA rewrites| S3Front
    CF -->|Path /api/*| Lambda
    Lambda -->|Presigned GET/PUT URLs| User
    User -->|Direct document upload| S3Docs
    Lambda -->|Item lookup & creation| DDB
```

### AWS Services Breakdown: What Each Service Does & Why

| AWS Service | Exact Role in DONTCBOARD | Why This Service Was Chosen |
| :--- | :--- | :--- |
| **AWS Certificate Manager (ACM)** | Issues free public SSL/TLS certificates for `dontcboard.me` and `www.dontcboard.me`. | Free of charge, automated renewals, enables end-to-end HTTPS. |
| **Amazon CloudFront (CDN)** | Global CDN receiving all incoming user traffic from DNS. | **1 TB free monthly bandwidth**. Serves frontend and routes `/api/*` under a single domain (`dontcboard.me`) to eliminate CORS entirely. Handles SPA 403/404 rewrites to `index.html`. |
| **Amazon S3 (Frontend Bucket)** | Stores static web assets: `index.html`, `sitemap.xml`, `robots.txt`, and icons. | Configured as **100% private** with Origin Access Control (OAC); only CloudFront edge servers can read it, preventing scraping or direct access. |
| **AWS Lambda (`dontcboard-api`)** | Serverless compute running API routes (`lambda.js`). | On-demand execution with zero server management. **1,000,000 free monthly requests**. Validates uploads, records DynamoDB items, and creates signed S3 URLs. |
| **Amazon DynamoDB (`easywritedown-pages`)** | Fast NoSQL page directory storing metadata. | Single-digit millisecond lookups by `pageName`. Serverless with an **Always Free Tier of 25 GB**. |
| **Amazon S3 (Documents Bucket)** | Object storage for uploaded PDF and PowerPoint files. | Direct-to-storage architecture: 100 MB files upload straight from the browser to S3 via pre-signed URLs, preventing server timeouts and payload limits. |

---

### How Data Moves Through the System

#### 1. When a user visits `https://dontcboard.me`:
- DNS directs the browser to CloudFront's nearest global edge server.
- CloudFront serves `index.html` cached at the edge. The site loads in milliseconds.

#### 2. When a user uploads a 100 MB file to page name `quarterly-report`:
1. The browser sends small JSON metadata (file name, size, page name) to `POST /api/upload-request`.
2. CloudFront routes this request to **AWS Lambda**.
3. Lambda checks the 100 MB limit, writes a record to **DynamoDB**, and requests a secure, 15-minute **pre-signed upload URL** from S3.
4. Lambda returns that URL to the browser.
5. The browser streams the 100 MB file **directly to Amazon S3**. *(The backend server never touches the heavy 100 MB file!)*
6. The browser redirects the user to `https://dontcboard.me/quarterly-report`.

#### 3. When someone opens `https://dontcboard.me/quarterly-report`:
1. CloudFront rewrites the path to `index.html` (HTTP 200).
2. The browser code reads `quarterly-report` from the URL and calls `GET /api/page?name=quarterly-report`.
3. Lambda finds the file key in **DynamoDB**, asks S3 for a temporary 1-hour view URL, and returns it.
4. The browser renders the PDF or PowerPoint slides directly from S3.

---

## Data Model

### DynamoDB table: `easywritedown-pages`

| Attribute | Type | Purpose |
| --- | --- | --- |
| `pageName` | String | Partition key and public page slug |
| `fileName` | String | Original uploaded file name |
| `fileType` | String | `pdf`, `ppt`, or `pptx` |
| `fileSize` | Number | File size in bytes |
| `s3Key` | String | Private object key in S3 |
| `contentType` | String | MIME type sent to S3 |
| `createdAt` | String | ISO 8601 publication timestamp |

No sort key is required for the current one-document-per-page model. Publishing the same page name replaces its DynamoDB metadata with a new object key.

## AWS Production Deployment

1. **Frontend Hosting (S3 + CloudFront)**:
   - S3 Bucket: `dontcboard-frontend-392087426683` (private, protected with Origin Access Control).
   - Contains `index.html`, `sitemap.xml`, `robots.txt`, and `icon.png`.
   - CloudFront Distribution: attached to ACM certificate in `us-east-1` for `dontcboard.me` and `www.dontcboard.me`.
   - Custom error responses: 403 and 404 rewrite to `/index.html` with HTTP 200 for SPA routing.

2. **Backend API (AWS Lambda Function)**:
   - Function: `dontcboard-api` (`Node.js 20.x/24.x`).
   - Handler code: `lambda.js` handling `GET /api/page` and `POST /api/upload-request`.
   - Attached to CloudFront behavior for path pattern `/api/*`.
   - IAM Execution Role policies: `AmazonDynamoDBFullAccess` and `AmazonS3FullAccess`.

3. **SEO & Google Search Console**:
   - `sitemap.xml`: XML sitemap listing `https://dontcboard.me/`, `/privacy`, and `/terms`.
   - `robots.txt`: Allows search crawlers and points to `https://dontcboard.me/sitemap.xml`.
   - Structured Data: JSON-LD `WebApplication` schema for rich indexing.
   - Canonical URLs: Absolute `https://dontcboard.me/` canonical tag.

## Local Development

Install dependencies and start the local server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API Reference

### `POST /api/upload-request`

Creates a presigned S3 upload URL and writes the page metadata record.

Request body:

```json
{
  "pageName": "quarterly-report",
  "fileName": "quarterly-report.pdf",
  "fileType": "pdf",
  "fileSize": 245760,
  "contentType": "application/pdf"
}
```

Successful response includes:

```json
{
  "success": true,
  "pageName": "quarterly-report",
  "uploadUrl": "https://...",
  "s3Key": "uploads/quarterly-report-...pdf"
}
```

### `GET /api/page?name=<page-name>`

Returns page metadata and a temporary S3 download URL when the page exists:

```json
{
  "exists": true,
  "pageName": "quarterly-report",
  "fileUrl": "https://...",
  "fileName": "quarterly-report.pdf",
  "fileType": "pdf",
  "fileSize": 245760,
  "createdAt": "2026-09-04T12:00:00.000Z"
}
```

## Project Structure

```text
.
├── index.html              # Frontend, viewer, IndexedDB fallback, and API client
├── api/
│   ├── upload-request.js   # Validates metadata, presigns S3 PUT, writes DynamoDB
│   └── page.js             # Reads DynamoDB and presigns S3 GET
├── server.js               # Local Node.js server and API router
├── vercel.json             # Vercel rewrites for API routes and page paths
├── .env.example            # AWS environment variable template
└── package.json             # Node.js scripts and AWS SDK dependencies
```

## Security and Production Notes

- Keep the S3 bucket private; do not use public-read bucket policies.
- Keep presigned URL lifetimes short. Upload URLs are currently 15 minutes and viewer URLs are currently 1 hour.
- Scope IAM permissions to the required bucket prefix and DynamoDB table.
- Restrict S3 CORS origins to known domains instead of `*`.
- Do not commit `.env`, access keys, or downloaded AWS credentials.
- Treat page names as public identifiers. Anyone with a page URL may be able to view the published document.
- Add authentication and authorization before using this for private documents.
- Add rate limiting, malware scanning, quotas, and abuse monitoring before accepting untrusted public uploads at scale.
- Consider moving the DynamoDB write until after the S3 upload succeeds, or adding cleanup/reconciliation, so a failed upload cannot leave metadata pointing at a missing object.
- Add a deletion workflow if users need to remove both the DynamoDB record and the S3 object.
- Review AWS CloudTrail, S3 lifecycle rules, DynamoDB costs, and retention requirements before production use.

## Troubleshooting

### `Network error during S3 file upload`

Check that:

- The S3 bucket CORS configuration includes the exact browser origin.
- The `Content-Type` used by the browser matches the content type used when the presigned URL was generated.
- The presigned URL has not expired.
- The API credentials can call `s3:PutObject` on the `uploads/*` prefix.

### The page says no document was found

Check that:

- `DYNAMODB_TABLE` matches the deployed table name.
- The API credentials can call `dynamodb:GetItem`.
- The upload request completed successfully.
- The `pageName` is normalized to the slug you are opening.

### AWS credentials are rejected

Check the region, access key, secret key, IAM permissions, and deployment environment. For local work, confirm that `.env` is present and that the process was restarted after changing it.

## License

This project is open-source and available under the [MIT License](LICENSE). Anyone can freely use, modify, and distribute the code, provided that the original copyright notice and permission notice are included. 

*Note: Users must set up and use their own AWS credentials and environment variables (`.env`) to run the infrastructure.*

## Built by DK 
