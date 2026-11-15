'use strict';

(() => {
  const messagesEl = document.getElementById('chatMessages');
  const formEl = document.getElementById('chatForm');
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');

  // 对话历史（不含 system，system 由后端注入）
  const history = [];

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function createMsgEl(role) {
    const wrap = document.createElement('div');
    wrap.className = 'msg msg--' + role;

    const avatar = document.createElement('div');
    avatar.className = 'msg__avatar';
    avatar.textContent = role === 'bot' ? '承' : '我';
    wrap.appendChild(avatar);

    const bubble = document.createElement('div');
    bubble.className = 'msg__bubble';
    wrap.appendChild(bubble);

    messagesEl.appendChild(wrap);
    scrollToBottom();
    return bubble;
  }

  function setLoading(isLoading) {
    sendBtn.disabled = isLoading;
    sendBtn.textContent = isLoading ? '回复中…' : '发送';
    inputEl.disabled = isLoading;
  }

  function appendLoading() {
    const bubble = createMsgEl('bot');
    bubble.classList.add('msg__bubble--loading');
    bubble.innerHTML = '<span></span><span></span><span></span>';
    return bubble;
  }

  function appendBotText(text) {
    const bubble = createMsgEl('bot');
    bubble.textContent = text;
  }

  function appendError(message) {
    const bubble = createMsgEl('bot');
    bubble.textContent = '⚠ ' + message;
    bubble.style.borderColor = '#0a0a0a';
    bubble.style.color = '#0a0a0a';
  }

  async function sendQuestion(text) {
    const question = text.trim();
    if (!question) return;
    if (sendBtn.disabled) return;

    // 用户消息
    const userBubble = createMsgEl('user');
    userBubble.textContent = question;
    inputEl.value = '';
    history.push({ role: 'user', content: question });

    setLoading(true);
    const loadingBubble = appendLoading();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });

      const data = await res.json().catch(() => ({}));

      // 移除加载气泡
      loadingBubble.parentElement.remove();

      if (!res.ok) {
        const errMsg = (data && data.error) || '请求失败，请稍后再试';
        appendError(errMsg);
      } else {
        const reply = (data && data.reply) || '';
        history.push({ role: 'assistant', content: reply });
        appendBotText(reply);
      }
    } catch (err) {
      loadingBubble.parentElement.remove();
      appendError('网络异常，请确认服务已启动（node server.js）');
    } finally {
      setLoading(false);
      inputEl.focus();
    }
  }

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    sendQuestion(inputEl.value);
  });

  // 兴趣标签：点击后向数字分身发送对应问题
  const chatSection = document.getElementById('chat');
  const tags = document.querySelectorAll('.tag');
  tags.forEach((tag) => {
    tag.addEventListener('click', () => {
      chatSection.scrollIntoView({ behavior: 'smooth' });
      sendQuestion(tag.dataset.question);
    });
  });

  // 联系方式：一键复制（优先 clipboard API，降级到临时 textarea）
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  // 复制提示 toast
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 1800);
  }

  document.querySelectorAll('.contact-card__copy').forEach((btn) => {
    const original = btn.textContent;
    const successMsg = btn.getAttribute('data-success') || '已复制 ✓';
    let timer = null;
    btn.addEventListener('click', async () => {
      const ok = await copyText(btn.getAttribute('data-copy') || '');
      clearTimeout(timer);
      if (ok) {
        btn.classList.add('is-copied');
        btn.textContent = successMsg;
        showToast(successMsg);
      } else {
        btn.textContent = '复制失败';
        showToast('复制失败，请手动复制');
      }
      timer = setTimeout(() => {
        btn.classList.remove('is-copied');
        btn.textContent = original;
      }, 1600);
    });
  });

})();
