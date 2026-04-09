const express = require('express');
const { execFile } = require('child_process');
const router = express.Router();

// Geolocate an IP using ip-api.com (free, no key, 1000/day)
function geolocateIP(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '*' || ip.startsWith('192.168.') || ip.startsWith('10.') ||
        ip.startsWith('127.') || ip.startsWith('172.16.') || ip.startsWith('172.31.')) {
      return resolve(null);
    }
    const url = `http://ip-api.com/json/${ip}?fields=status,lat,lon,city,country,isp,org,query`;
    const req = require('http').get(url, { timeout: 3000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(j.status === 'success' ? j : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// Parse traceroute output (Linux -n format)
function parseTraceroute(output) {
  const hops = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(?:(\S+)\s+\((\d+\.\d+\.\d+\.\d+)\)|(\d+\.\d+\.\d+\.\d+)|\*)\s*([\d.]+ ms)?/);
    if (!match) continue;
    const hopNum = parseInt(match[1]);
    const ip = match[3] || match[4] || null;
    const rtt = match[5] ? parseFloat(match[5]) : null;
    if (ip) hops.push({ hop: hopNum, ip, rtt });
  }
  return hops;
}

// Parse tracepath output (Linux format)
// e.g. " 1?:  [LOCALHOST]  pmtu 1500"
// e.g. " 1:   192.168.0.1   5.107ms"
// e.g. " 4:   172.16.250.40  37.156ms asymm 8"
function parseTracepath(output) {
  const hops = [];
  const seen = new Set();
  for (const line of output.split('\n')) {
    // Match "  N?:  IP  RTT" or "  N:  IP  RTT"
    const match = line.match(/^\s*(\d+)\??:\s+(\d+\.\d+\.\d+\.\d+)\s+([\d.]+ms)?/);
    if (!match) continue;
    const hopNum = parseInt(match[1]);
    const ip = match[2];
    const rtt = match[3] ? parseFloat(match[3]) : null;
    if (!seen.has(ip)) {
      seen.add(ip);
      hops.push({ hop: hopNum, ip, rtt });
    }
  }
  return hops;
}

// POST /api/traceroute { target: 'ip_or_hostname' }
router.post('/', async (req, res) => {
  const target = (req.body?.target || '').trim().replace(/[^a-zA-Z0-9.\-_]/g, '');
  if (!target) return res.status(400).json({ error: 'target required' });

  // Try traceroute first, fall back to tracepath
  const useTraceroute = await new Promise(r => {
    execFile('which', ['traceroute'], (err) => r(!err));
  });

  const [cmd, args, parser] = useTraceroute
    ? ['traceroute', ['-n', '-m', '12', '-w', '1', target], parseTraceroute]
    : ['tracepath', ['-n', '-m', '10', target], parseTracepath];

  // Use spawn to stream output so partial results are captured even on timeout
  const result = await new Promise((resolve) => {
    const { spawn } = require('child_process');
    let out = '';
    const proc = spawn(cmd, args);
    const killTimer = setTimeout(() => { proc.kill(); resolve(out); }, 20000);
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { out += d.toString(); });
    proc.on('close', () => { clearTimeout(killTimer); resolve(out); });
    proc.on('error', () => { clearTimeout(killTimer); resolve(out); });
  });

  const rawHops = parser(result);

  // Geolocate all hops in parallel
  const geoResults = await Promise.all(rawHops.map(h => geolocateIP(h.ip)));

  const hops = rawHops.map((h, i) => {
    const geo = geoResults[i];
    return {
      hop: h.hop,
      ip: h.ip,
      rtt: h.rtt,
      lat: geo?.lat || null,
      lon: geo?.lon || null,
      city: geo?.city || null,
      country: geo?.country || null,
      org: geo?.org || geo?.isp || null,
    };
  }).filter(h => h.lat && h.lon);

  res.json({ target, hops, raw: result });
});

module.exports = router;
