'use strict';

/**
 * 承佳豪个人主页 —— 零依赖 Node 代理服务
 * 职责：
 *  1. 托管静态文件（index.html / styles.css / script.js）
 *  2. 提供 POST /api/chat，转发到 DeepSeek，保护 API Key 不暴露在前端
 * 仅使用 Node 内置模块，无需 npm install。
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ---------- 可配置项 ----------
const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const ROOT_DIR = __dirname;
const STATIC_FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/styles.css': 'styles.css',
  '/script.js': 'script.js',
  '/avatar.jpg': 'avatar.jpg',
  '/resume.pdf': 'resume.pdf',
};

// 数字分身人设（system prompt）：唯一来源是 rag/system.md，线上 Dify 知识库也用同一份
const SYSTEM_PROMPT = fs.readFileSync(path.join(ROOT_DIR, 'rag', 'system.md'), 'utf8');

// ---------- 读取 .env ----------
function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (_) {
    // 忽略 .env 读取失败
  }
}
loadEnvFile(path.join(ROOT_DIR, '.env'));

// ---------- 工具函数 ----------
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- 静态文件服务 ----------
function serveStatic(req, res, filePath) {
  const fullPath = path.join(ROOT_DIR, filePath);
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.pdf': 'application/pdf',
      '.ico': 'image/x-icon',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------- DeepSeek 转发 ----------
function callDeepSeek(messages) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.7,
      max_tokens: 800,
      stream: false,
    });

    const url = new URL(DEEPSEEK_BASE_URL + '/chat/completions');
    const options = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY,
      },
      timeout: 30000,
    };

    const upstreamReq = https.request(options, (upstreamRes) => {
      let data = '';
      upstreamRes.on('data', (chunk) => (data += chunk));
      upstreamRes.on('end', () => {
        if (upstreamRes.statusCode !== 200) {
          let message = 'DeepSeek 返回错误：' + upstreamRes.statusCode;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error && parsed.error.message) {
              message = parsed.error.message;
            }
          } catch (_) {}
          reject(new Error(message));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const reply =
            parsed.choices &&
            parsed.choices[0] &&
            parsed.choices[0].message &&
            parsed.choices[0].message.content;
          if (!reply) {
            reject(new Error('DeepSeek 返回内容为空'));
            return;
          }
          resolve(reply);
        } catch (err) {
          reject(new Error('解析 DeepSeek 响应失败'));
        }
      });
    });

    upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('请求超时')));
    upstreamReq.on('error', reject);
    upstreamReq.write(payload);
    upstreamReq.end();
  });
}

// ---------- 路由 ----------
async function handleChat(req, res) {
  const raw = await readRequestBody(req);
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch (_) {
    sendJson(res, 400, { error: '请求体不是合法的 JSON' });
    return;
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    sendJson(res, 400, { error: 'messages 不能为空' });
    return;
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    sendJson(res, 500, {
      error: '服务端未配置 DEEPSEEK_API_KEY，请在 .env 或环境变量中设置后重启服务',
    });
    return;
  }

  // 只保留 role/content，避免前端注入多余字段
  const cleaned = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  if (cleaned.length === 0) {
    sendJson(res, 400, { error: '没有可用的消息内容' });
    return;
  }

  try {
    const reply = await callDeepSeek(cleaned);
    sendJson(res, 200, { reply });
  } catch (err) {
    sendJson(res, 502, { error: err.message || '请求 DeepSeek 失败' });
  }
}

// ---------- 服务器 ----------
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/chat') {
    try {
      await handleChat(req, res);
    } catch (err) {
      sendJson(res, 500, { error: err.message || '服务器内部错误' });
    }
    return;
  }

  if (req.method === 'GET' && pathname in STATIC_FILES) {
    serveStatic(req, res, STATIC_FILES[pathname]);
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, HOST, () => {
  console.log('==============================================');
  console.log('  承佳豪个人主页 已启动');
  console.log('  预览地址： http://' + HOST + ':' + PORT);
  console.log('==============================================');
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log('  [提示] 尚未配置 DEEPSEEK_API_KEY');
    console.log('  请复制 .env.example 为 .env 并填入你的 Key，然后重启服务。');
    console.log('----------------------------------------------');
  }
});
