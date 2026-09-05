function getSiteUrl(req) {
  const configuredUrl = process.env.SITE_URL || (process.env.VERCEL ? 'https://dontcboard.me' : null);
  if (configuredUrl) return configuredUrl.replace(/\/$/, '');

  const forwardedProto = (req.headers && req.headers['x-forwarded-proto']) || 'https';
  const protocol = forwardedProto.split(',')[0].trim();
  const host = (req.headers && req.headers.host) || 'localhost:3000';
  return `${protocol}://${host}`.replace(/\/$/, '');
}

module.exports = { getSiteUrl };