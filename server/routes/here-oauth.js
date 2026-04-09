// Shared HERE OAuth 2.0 token helper
// Used by here.js (fetch) and settings.js (validate)
const https  = require('https');
const crypto = require('crypto');

let _token   = null;
let _tokenTs = 0;
const TOKEN_TTL = 23 * 60 * 60 * 1000; // 23h (tokens last 24h)

function pct(s) {
  return encodeURIComponent(String(s))
    .replace(/!/g,'%21').replace(/'/g,'%27')
    .replace(/\(/g,'%28').replace(/\)/g,'%29').replace(/\*/g,'%2A');
}

// getOAuthToken(id, secret) — pass explicit creds or omit to read from process.env
async function getOAuthToken(id, secret) {
  id     = id     || process.env.HERE_ACCESS_KEY_ID;
  secret = secret || process.env.HERE_ACCESS_KEY_SECRET;
  if (!id || !secret) throw new Error('HERE OAuth credentials not set');

  if (_token && Date.now() - _tokenTs < TOKEN_TTL) return _token;

  const tokenUrl = 'https://account.api.here.com/oauth2/token';
  const nonce    = crypto.randomBytes(16).toString('hex');
  const ts       = Math.floor(Date.now() / 1000).toString();

  const allParams = {
    grant_type:             'client_credentials',
    oauth_consumer_key:     id,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp:        ts,
    oauth_version:          '1.0',
  };

  const paramStr = Object.entries(allParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${pct(k)}=${pct(v)}`)
    .join('&');

  const baseStr    = `POST&${pct(tokenUrl)}&${pct(paramStr)}`;
  const signingKey = `${pct(secret)}&`;
  const signature  = crypto.createHmac('sha256', signingKey).update(baseStr).digest('base64');

  const authHeader = 'OAuth realm="",' + [
    ['oauth_consumer_key',    id],
    ['oauth_nonce',           nonce],
    ['oauth_signature_method','HMAC-SHA256'],
    ['oauth_timestamp',       ts],
    ['oauth_version',         '1.0'],
    ['oauth_signature',       signature],
  ].map(([k, v]) => `${k}="${pct(v)}"`).join(',');

  const body = 'grant_type=client_credentials';

  const token = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'account.api.here.com',
      path:     '/oauth2/token',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Authorization:    authHeader,
        'User-Agent':     'StrayaNow/1.0',
      },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.access_token) resolve(j.access_token);
          else reject(new Error(`HERE OAuth failed (${res.statusCode}): ${buf.slice(0, 200)}`));
        } catch { reject(new Error(`HERE OAuth response not JSON: ${buf.slice(0, 120)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('HERE OAuth timeout')); });
    req.write(body);
    req.end();
  });

  _token   = token;
  _tokenTs = Date.now();
  console.log('[here] OAuth token obtained');
  return token;
}

module.exports = { getOAuthToken };
