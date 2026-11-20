// EdgeOne Pages Function：POST /api/chat
// 线上后端。EdgeOne Pages 静态托管不会运行 server.js，后端必须放进 /functions 目录才会被执行。
// 人设不在本文件里：线上由 Dify 平台配置，资料唯一来源是 rag/system.md（改人设后需重新上传到 Dify 知识库）。
// API Key 从环境变量 env.DIFY_API_KEY 读取，切勿写进代码。

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json(400, { error: '请求体不是合法的 JSON' });
  }

  const messages = body && body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: 'messages 不能为空' });
  }

  const apiKey = env && env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return json(500, {
      error: '服务端未配置 DEEPSEEK_API_KEY，请在 EdgeOne Pages 控制台的环境变量中设置后重新部署',
    });
  }

  const cleaned = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  if (cleaned.length === 0) {
    return json(400, { error: '没有可用的消息内容' });
  }

  // 1. 从环境变量读取 Dify 的配置
  const difyBaseUrl = (env && env.DIFY_API_URL) || 'https://api.dify.ai/v1';
  const difyApiKey = env && env.DIFY_API_KEY;

  // 2. 检查 Key 是否存在
  if (!difyApiKey) {
    return json(500, { error: "服务端未配置 DIFY_API_KEY，请在 EdgeOne 环境变量中设置" });
  }

  // 3. 构建发给 Dify 的请求体
  const difyPayload = {
    inputs: {}, 
    // 取用户最后一条消息作为提问
    query: body.messages[body.messages.length - 1].content, 
    response_mode: "blocking", 
    conversation_id: "", 
    user: "web-visitor" 
  };

  // 4. 设置超时控制器（防止请求卡死）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    // 5. 向 Dify 发起请求
    const upstream = await fetch(`${difyBaseUrl}/chat-messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${difyApiKey}`
      },
      body: JSON.stringify(difyPayload),
      signal: controller.signal
    });

    // 6. 解析 Dify 的返回结果
    const difyData = await upstream.json().catch(() => ({}));
    
    if (!upstream.ok) {
      const message = (difyData && difyData.message) || `Dify 返回错误: ${upstream.status}`;
      return json(502, { error: message });
    }

  // 7. 提取回答并清洗思考标签
  let reply = difyData.answer || "抱歉，没有获取到有效回复。";
  
  // 过滤掉 <think>...</think> 以及中间的思考内容（支持跨行匹配）
  reply = reply.replace(/<think[\s\S]*?<\/think>/gi, '').trim();
  
  // 如果思考过程被截断、缺失了开标签，过滤掉残留的结束标签
  reply = reply.replace(/<\/think>/gi, '').trim();
  
  // 兜底处理：万一模型只输出了思考过程，导致清洗后为空
  if (!reply) {
    reply = "抱歉，没有获取到有效回答，请稍后再试。";
  }

  return json(200, { reply });

  } catch (err) {
    const message = err && err.name === 'AbortError' ? '请求超时' : (err && err.message) || '请求 Dify 失败';
    return json(502, { error: message });
  } finally {
    clearTimeout(timer);
  }
}