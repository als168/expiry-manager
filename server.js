const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const SEED_FILES = [path.join(__dirname, 'seed', 'services.json'), path.join(__dirname, 'services.json')];

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (Array.isArray(raw)) return raw;
    }
  } catch (e) { /* fall through to seed */ }
  for (const seedFile of SEED_FILES) {
    try {
      const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
      if (Array.isArray(seed)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2));
        return seed;
      }
    } catch (e) { /* try next seed location */ }
  }
  return [];
}

function saveData(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

let services = loadData();

const TYPES = ['主机', 'VPS', '域名', '建站', '存储', '服务', '其他'];

function cleanService(input, keepId) {
  const s = {};
  if (keepId) s.id = keepId;
  s.name = String(input.name || '').trim();
  s.provider = String(input.provider || '').trim();
  s.type = TYPES.includes(input.type) ? input.type : '其他';
  const expiry = String(input.expiry || '').trim();
  s.expiry = /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : null;
  s.cost = String(input.cost || '').trim();
  s.period = ['月', '年', '一次性', '免费', ''].includes(input.period) ? input.period : '';
  s.note = String(input.note || '').trim();
  return s;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req, limit, cb) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > limit) { req.destroy(); cb(new Error('body too large')); }
  });
  req.on('end', () => cb(null, body));
  req.on('error', (err) => cb(err));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'GET' && p === '/') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); return res.end('index.html missing'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET' && p === '/api/services') {
    return sendJson(res, 200, { services });
  }

  if (req.method === 'POST' && p === '/api/services') {
    return readBody(req, 100 * 1024, (err, body) => {
      if (err) return sendJson(res, 400, { error: 'bad body' });
      let input;
      try { input = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
      const s = cleanService(input);
      if (!s.name) return sendJson(res, 400, { error: 'name required' });
      s.id = crypto.randomUUID();
      services.push(s);
      saveData(services);
      sendJson(res, 201, { service: s });
    });
  }

  if ((req.method === 'PUT' || req.method === 'DELETE') && p.startsWith('/api/services/')) {
    const id = decodeURIComponent(p.slice('/api/services/'.length));
    const idx = services.findIndex((s) => s.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'not found' });
    if (req.method === 'DELETE') {
      services.splice(idx, 1);
      saveData(services);
      return sendJson(res, 200, { ok: true });
    }
    return readBody(req, 100 * 1024, (err, body) => {
      if (err) return sendJson(res, 400, { error: 'bad body' });
      let input;
      try { input = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
      const s = cleanService(input, id);
      if (!s.name) return sendJson(res, 400, { error: 'name required' });
      services[idx] = s;
      saveData(services);
      sendJson(res, 200, { service: s });
    });
  }

  if (req.method === 'POST' && p === '/api/import') {
    return readBody(req, 500 * 1024, (err, body) => {
      if (err) return sendJson(res, 400, { error: 'bad body' });
      let input;
      try { input = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
      const list = Array.isArray(input) ? input : input.services;
      if (!Array.isArray(list)) return sendJson(res, 400, { error: 'services array required' });
      const cleaned = [];
      for (const item of list) {
        const s = cleanService(item || {});
        if (!s.name) continue;
        s.id = typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID();
        cleaned.push(s);
      }
      services = cleaned;
      saveData(services);
      sendJson(res, 200, { ok: true, count: services.length });
    });
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log('expiry-manager listening on ' + PORT);
});
