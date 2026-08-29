const MUFG_BASE = 'https://in.mpms.mufg.com/Initial_Offer/IPO.aspx';

const HEADERS = {
  'Content-Type': 'application/json; charset=UTF-8',
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'X-Requested-With': 'XMLHttpRequest',
  Referer: 'https://in.mpms.mufg.com/Initial_Offer/IPO.aspx',
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
}

function parseIpos(rawXml) {
  const ipos = [];
  const tableRegex = /<Table>([\s\S]*?)<\/Table>/g;
  let match;
  while ((match = tableRegex.exec(rawXml)) !== null) {
    const block = match[1];
    const id = block.match(/<company_id>(.*?)<\/company_id>/)?.[1];
    const name = block.match(/<companyname>(.*?)<\/companyname>/)?.[1];
    if (id && name) ipos.push({ id, name });
  }
  return ipos;
}

async function getMufgList() {
  const response = await fetch(`${MUFG_BASE}/GetDetails`, {
    method: 'POST',
    headers: HEADERS,
    body: '{}',
  });
  const data = await response.json();
  return parseIpos(data.d || '');
}

async function mufgSearch(body) {
  const payload = {
    clientid: String(body.clientid || '').trim(),
    PAN: String(body.PAN || '').trim().toUpperCase(),
    IFSC: String(body.IFSC || ''),
    CHKVAL: String(body.CHKVAL || '1'),
    token: String(body.token || ''),
  };
  return fetch(`${MUFG_BASE}/SearchOnPan`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(payload),
  });
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const action = (req.query && req.query.action) || (req.body && req.body.action) || '';

  if (req.method === 'GET' && action === 'ipos') {
    try {
      res.status(200).json(await getMufgList());
    } catch (error) {
      res.status(502).json({ error: `MUFG Error: ${error.message || error}` });
    }
    return;
  }

  if (req.method === 'POST') {
    if (String(action).toLowerCase() === 'ipos') {
      try {
        res.status(200).json(await getMufgList());
      } catch (error) {
        res.status(502).json({ error: `MUFG Error: ${error.message || error}` });
      }
      return;
    }

    try {
      const upstream = await mufgSearch(req.body || {});
      const text = await upstream.text();
      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
      res.end(text);
    } catch (error) {
      res.status(502).json({ error: String(error.message || error) });
    }
    return;
  }

  res.status(404).json({ error: 'Not found' });
};
