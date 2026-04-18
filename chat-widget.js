(function () {
  'use strict';

  /* ========== Default Config ========== */
  var DEFAULT_CONFIG = {
    primaryColor: '#667eea',
    title: 'AI 助手',
    subtitle: '随时为您解答',
    placeholder: '输入消息...',
    welcomeMessage: '你好！我是 AI 助手，有什么可以帮你的吗？',
    position: 'right',
    bottomOffset: 24,
    sideOffset: 24,
    bubbleSize: 60,
    botId: '4dd490e9-88e7-4e3c-a282-0350d9e53249',
    accessKeyId: '3bcdd1d9-a0ea-43df-9d76-221491571049',
    accessKeySecret: 'MjJiMTBlZDEtZTNhMi00ZTJkLTlmN2ItMWU5NmEwNDRjMDUy',
    apiBase: 'https://insight.juzibot.com',
    botAvatar: null,
    trackingEndpoint: 'http://localhost:3200/api/track/collect',
    enableTracking: true,
    agentId: null,
    agentConfigEndpoint: null,
    presetQuestions: null
  };

  var config = {};
  var isOpen = false;
  var isDragging = false;
  var dragStartX = 0;
  var dragStartY = 0;
  var bubbleStartX = 0;
  var bubbleStartY = 0;
  var hasMoved = false;
  var chatHistory = [];       // {text, isSelf} for API
  var messageIdCounter = 0;
  var accessToken = null;
  var tokenExpiresAt = 0;
  var sessionId = null;
  var isSending = false;
  var trackUserId = null;
  var trackQueue = [];
  var trackTimer = null;
  var sessionMode = 'ai';
  var pollingTimer = null;
  var lastMessageId = 0;
  var pollingFailCount = 0;
  var POLLING_INTERVAL = 3000;
  var POLLING_SLOW_INTERVAL = 10000;
  var POLLING_FAIL_THRESHOLD = 3;
  var widgetBuilt = false;
  var pendingSessionReset = false;
  var sessionStarted = false;

  Object.keys(DEFAULT_CONFIG).forEach(function (k) {
    config[k] = DEFAULT_CONFIG[k];
  });

  /* ========== Tracking: 埋点上报 ========== */
  function getOrCreateUserId() {
    if (trackUserId) return trackUserId;
    try {
      trackUserId = localStorage.getItem('ai_chat_uid');
      if (!trackUserId) {
        trackUserId = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 10);
        localStorage.setItem('ai_chat_uid', trackUserId);
      }
    } catch (e) {
      trackUserId = 'u_anon_' + Math.random().toString(36).substr(2, 10);
    }
    return trackUserId;
  }

  function getDeviceInfo() {
    var ua = navigator.userAgent || '';
    var isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
    var browser = 'unknown';
    if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) browser = 'Chrome';
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';
    else if (/Edg/i.test(ua)) browser = 'Edge';
    var os = 'unknown';
    if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Mac OS/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
    return { type: isMobile ? 'mobile' : 'desktop', browser: browser, os: os };
  }

  function trackEvent(evt) {
    if (!config.enableTracking) return;
    trackQueue.push(evt);
    // 批量上报：500ms 内的事件合并发送
    if (!trackTimer) {
      trackTimer = setTimeout(flushTrackQueue, 500);
    }
  }

  function flushTrackQueue() {
    trackTimer = null;
    if (trackQueue.length === 0) return;
    var eventsToSend = trackQueue.slice();
    trackQueue = [];

    var payload = {
      userId: getOrCreateUserId(),
      sessionId: sessionId,
      botId: config.botId,
      pageUrl: location.href,
      referrer: document.referrer,
      device: getDeviceInfo(),
      events: eventsToSend
    };

    try {
      var jsonBody = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        var blob = new Blob([jsonBody], { type: 'application/json' });
        navigator.sendBeacon(config.trackingEndpoint, blob);
      } else {
        fetch(config.trackingEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonBody,
          keepalive: true
        }).catch(function (err) {
          console.warn('[AI Chat Widget] 埋点上报失败:', err);
        });
      }
    } catch (e) {
      console.warn('[AI Chat Widget] 埋点上报异常:', e);
    }
  }

  /* ========== Generate Session ID ========== */
  function generateSessionId() {
    return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8);
  }

  /* ========== Auth: Get Access Token ========== */
  function getAccessToken() {
    // Return cached token if still valid (with 5-min buffer)
    if (accessToken && Date.now() < tokenExpiresAt - 300000) {
      return Promise.resolve(accessToken);
    }

    return fetch(config.apiBase + '/openapi/get-access-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret
      })
    })
    .then(function (res) {
      if (!res.ok) throw new Error('Auth failed: ' + res.status);
      return res.json();
    })
    .then(function (data) {
      if (data.code !== 0 && data.code !== 200) {
        throw new Error('Auth error: code=' + data.code);
      }
      accessToken = data.data.accessToken;
      tokenExpiresAt = Date.now() + data.data.expiresIn * 1000;
      return accessToken;
    });
  }

  /* ========== Streaming Chat API ========== */
  function streamChat(userMessage, onChunk, onDone, onError) {
    getAccessToken().then(function (token) {
      var body = {
        botId: config.botId,
        sessionId: sessionId,
        message: { type: 'text', text: userMessage },
        history: chatHistory.slice(),
        stream: true
      };

      fetch(config.apiBase + '/openapi/bot/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(body)
      })
      .then(function (res) {
        if (!res.ok) {
          // If 401, clear token and retry once
          if (res.status === 401) {
            accessToken = null;
            tokenExpiresAt = 0;
            return getAccessToken().then(function (newToken) {
              return fetch(config.apiBase + '/openapi/bot/message', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + newToken
                },
                body: JSON.stringify(body)
              });
            });
          }
          throw new Error('Chat API error: ' + res.status);
        }
        return res;
      })
      .then(function (res) {
        if (!res.ok) throw new Error('Chat API error after retry: ' + res.status);
        console.log('[AI Chat Widget] Chat response status:', res.status);
        // Check if body is readable as stream
        if (res.body && typeof res.body.getReader === 'function') {
          return readStream(res, onChunk, onDone);
        }
        // Fallback: read as text
        console.log('[AI Chat Widget] No readable stream, falling back to text()');
        return res.text().then(function (text) {
          console.log('[AI Chat Widget] Fallback text response:', text.substring(0, 500));
          try {
            var json = JSON.parse(text);
            var msg = extractTextFromJSON(json);
            if (msg) {
              onChunk(msg, msg);
              onDone(msg);
              return;
            }
          } catch (e) {}
          // Try as plain text
          if (text) {
            onChunk(text, text);
            onDone(text);
          } else {
            onDone('');
          }
        });
      })
      .catch(function (err) {
        onError(err);
      });
    }).catch(function (err) {
      onError(err);
    });
  }

  function readStream(response, onChunk, onDone) {
    var contentType = response.headers.get('content-type') || '';
    console.log('[AI Chat Widget] Response content-type:', contentType);

    // If response is plain JSON (not streaming), handle it directly
    if (contentType.indexOf('application/json') !== -1) {
      console.log('[AI Chat Widget] Non-streaming JSON response detected');
      response.json().then(function (data) {
        console.log('[AI Chat Widget] JSON response:', JSON.stringify(data).substring(0, 500));
        var text = extractTextFromJSON(data);
        if (text) {
          onChunk(text, text);
        }
        onDone(text);
      }).catch(function (err) {
        console.error('[AI Chat Widget] JSON parse error:', err);
        onDone('');
      });
      return;
    }

    // Streaming response
    var reader = response.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buffer = '';
    var fullText = '';
    var rawChunks = []; // for debugging

    function read() {
      reader.read().then(function (result) {
        if (result.done) {
          // Process any remaining buffer
          if (buffer.trim()) {
            processSSEData(buffer, function (text) {
              fullText += text;
              onChunk(text, fullText);
            });
          }
          console.log('[AI Chat Widget] Stream done. fullText length:', fullText.length);
          if (!fullText && rawChunks.length > 0) {
            console.log('[AI Chat Widget] Raw chunks for debugging:', rawChunks);
          }
          onDone(fullText);
          return;
        }

        var chunk = decoder.decode(result.value, { stream: true });
        rawChunks.push(chunk);
        if (rawChunks.length <= 3) {
          console.log('[AI Chat Widget] Raw chunk #' + rawChunks.length + ':', JSON.stringify(chunk).substring(0, 300));
        }

        buffer += chunk;

        // Process complete lines (split by newline)
        var lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete last line in buffer

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.trim()) continue;
          processSSEData(line, function (text) {
            fullText += text;
            onChunk(text, fullText);
          });
        }

        read();
      }).catch(function (err) {
        console.error('[AI Chat Widget] Stream read error:', err);
        onDone(fullText || '');
      });
    }

    read();
  }

  /* Extract text from any known JSON response shape */
  function extractTextFromJSON(obj) {
    if (!obj) return '';
    // { code: 0, data: { message: "..." } }
    if (obj.data && typeof obj.data.message === 'string') return obj.data.message;
    // { data: { content: "..." } }
    if (obj.data && typeof obj.data.content === 'string') return obj.data.content;
    // { data: { text: "..." } }
    if (obj.data && typeof obj.data.text === 'string') return obj.data.text;
    // { data: "..." }
    if (typeof obj.data === 'string') return obj.data;
    // { message: "..." }
    if (typeof obj.message === 'string') return obj.message;
    // { content: "..." }
    if (typeof obj.content === 'string') return obj.content;
    // { text: "..." }
    if (typeof obj.text === 'string') return obj.text;
    // { choices: [{ delta: { content } }] } (OpenAI-like)
    if (obj.choices && obj.choices[0]) {
      var c = obj.choices[0];
      if (c.delta && typeof c.delta.content === 'string') return c.delta.content;
      if (c.message && typeof c.message.content === 'string') return c.message.content;
      if (typeof c.text === 'string') return c.text;
    }
    return '';
  }

  function processSSEData(line, callback) {
    var trimmed = line.trim();
    if (!trimmed) return;

    var dataStr = trimmed;

    // Strip SSE "data:" prefix if present
    if (trimmed.indexOf('data:') === 0) {
      dataStr = trimmed.substring(5).trim();
    }
    // Strip "event:" lines
    if (trimmed.indexOf('event:') === 0 || trimmed.indexOf('id:') === 0 || trimmed.indexOf('retry:') === 0) {
      return;
    }

    if (!dataStr || dataStr === '[DONE]') return;

    // Try to parse as JSON
    try {
      var parsed = JSON.parse(dataStr);
      var text = extractTextFromJSON(parsed);
      if (text) {
        callback(text);
        return;
      }
      // If parsed but no text extracted, log it
      if (typeof parsed === 'string') {
        callback(parsed);
        return;
      }
      console.log('[AI Chat Widget] Parsed JSON but no text found:', JSON.stringify(parsed).substring(0, 200));
    } catch (e) {
      // Not JSON - could be plain text chunk
      // Only treat as text if it doesn't look like SSE metadata
      if (dataStr.indexOf(':') !== 0) {
        callback(dataStr);
      }
    }
  }

  /* ========== Inject CSS ========== */
  function injectStyles() {
    if (document.getElementById('ai-chat-widget-styles')) return;
    var style = document.createElement('style');
    style.id = 'ai-chat-widget-styles';
    style.textContent = getCSS();
    document.head.appendChild(style);
  }

  function getCSS() {
    var pc = config.primaryColor;
    return '#ai-chat-bubble{position:fixed;z-index:10000;width:' + config.bubbleSize + 'px;height:' + config.bubbleSize + 'px;border-radius:50%;background:linear-gradient(135deg,' + pc + ' 0%,#764ba2 100%);box-shadow:0 4px 20px rgba(102,126,234,0.4);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .3s ease,box-shadow .3s ease;user-select:none;-webkit-user-select:none;touch-action:none;}' +
    '#ai-chat-bubble:hover{transform:scale(1.1);box-shadow:0 6px 28px rgba(102,126,234,0.55);}' +
    '#ai-chat-bubble .bubble-icon{width:28px;height:28px;fill:white;transition:transform .3s ease;}' +
    '#ai-chat-bubble.open .bubble-icon{transform:rotate(90deg);}' +
    '#ai-chat-bubble .unread-dot{position:absolute;top:2px;right:2px;width:14px;height:14px;background:#ff4757;border-radius:50%;border:2px solid white;display:none;}' +
    '#ai-chat-window{position:fixed;z-index:9999;width:380px;height:560px;max-height:80vh;max-width:calc(100vw - 32px);border-radius:16px;background:#fff;box-shadow:0 12px 48px rgba(0,0,0,0.15);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(20px) scale(0.95);transition:opacity .3s ease,transform .3s ease;pointer-events:none;}' +
    '#ai-chat-window.visible{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}' +
    '#ai-chat-window .chat-header{background:linear-gradient(135deg,' + pc + ' 0%,#764ba2 100%);color:white;padding:16px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0;}' +
    '#ai-chat-window .chat-header .header-avatar{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;}' +
    '#ai-chat-window .chat-header .header-avatar svg{width:22px;height:22px;fill:white;}' +
    '#ai-chat-window .chat-header .header-info{flex:1;}' +
    '#ai-chat-window .chat-header .header-title{font-size:16px;font-weight:600;margin:0;}' +
    '#ai-chat-window .chat-header .header-subtitle{font-size:12px;opacity:0.8;margin-top:2px;}' +
    '#ai-chat-window .chat-header .header-close{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s;}' +
    '#ai-chat-window .chat-header .header-close:hover{background:rgba(255,255,255,0.3);}' +
    '#ai-chat-window .chat-header .header-close svg{width:16px;height:16px;fill:white;}' +
    '#ai-chat-window .chat-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;scroll-behavior:smooth;}' +
    '#ai-chat-window .chat-messages::-webkit-scrollbar{width:4px;}' +
    '#ai-chat-window .chat-messages::-webkit-scrollbar-track{background:transparent;}' +
    '#ai-chat-window .chat-messages::-webkit-scrollbar-thumb{background:#ddd;border-radius:4px;}' +
    '.chat-msg{display:flex;gap:8px;max-width:85%;animation:msg-in .3s ease;}' +
    '.chat-msg.bot{align-self:flex-start;}' +
    '.chat-msg.user{align-self:flex-end;flex-direction:row-reverse;}' +
    '.chat-msg .msg-avatar{width:32px;height:32px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px;}' +
    '.chat-msg.bot .msg-avatar{background:linear-gradient(135deg,' + pc + ',#764ba2);color:white;}' +
    '.chat-msg.user .msg-avatar{background:#e8eaed;color:#555;}' +
    '.chat-msg .msg-content{display:flex;flex-direction:column;}' +
    '.chat-msg .msg-bubble{padding:10px 14px;border-radius:16px;font-size:14px;line-height:1.6;word-break:break-word;}' +
    '.chat-msg.bot .msg-bubble{background:#f0f2f5;color:#333;border-bottom-left-radius:4px;}' +
    '.chat-msg.user .msg-bubble{background:linear-gradient(135deg,' + pc + ',#764ba2);color:white;border-bottom-right-radius:4px;}' +
    '.chat-msg .msg-time{font-size:11px;color:#999;margin-top:4px;padding:0 4px;}' +
    '.chat-msg.user .msg-time{text-align:right;}' +
    '@keyframes msg-in{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}' +
    '.typing-indicator{display:flex;gap:4px;padding:4px 0;align-items:center;}' +
    '.typing-indicator span{width:7px;height:7px;border-radius:50%;background:#999;animation:typing-bounce .6s ease infinite;}' +
    '.typing-indicator span:nth-child(2){animation-delay:.15s;}' +
    '.typing-indicator span:nth-child(3){animation-delay:.3s;}' +
    '@keyframes typing-bounce{0%,100%{transform:translateY(0);opacity:.4;}50%{transform:translateY(-4px);opacity:1;}}' +
    '#ai-chat-window .chat-input-area{padding:12px 16px;border-top:1px solid #eee;display:flex;gap:8px;align-items:flex-end;flex-shrink:0;background:#fff;}' +
    '#ai-chat-window .chat-input-area textarea{flex:1;border:1px solid #e0e0e0;border-radius:20px;padding:10px 16px;font-size:14px;font-family:inherit;resize:none;outline:none;max-height:100px;line-height:1.4;transition:border-color .2s;}' +
    '#ai-chat-window .chat-input-area textarea:focus{border-color:' + pc + ';}' +
    '#ai-chat-window .chat-input-area .send-btn{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,' + pc + ',#764ba2);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .2s,opacity .2s;opacity:0.6;}' +
    '#ai-chat-window .chat-input-area .send-btn:hover{transform:scale(1.05);opacity:1;}' +
    '#ai-chat-window .chat-input-area .send-btn.active{opacity:1;}' +
    '#ai-chat-window .chat-input-area .send-btn:disabled{opacity:0.3;cursor:not-allowed;transform:none;}' +
    '#ai-chat-window .chat-input-area .send-btn svg{width:18px;height:18px;fill:white;}' +
    '#ai-chat-window .chat-footer{text-align:center;padding:6px;font-size:11px;color:#bbb;flex-shrink:0;}' +
    '.quick-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}' +
    '.quick-actions button{background:white;border:1px solid #e0e0e0;border-radius:16px;padding:6px 14px;font-size:12px;cursor:pointer;transition:all .2s;color:#555;}' +
    '.quick-actions button:hover{border-color:' + pc + ';color:' + pc + ';background:#f8f9ff;}' +
    '.stream-cursor{display:inline-block;width:2px;height:14px;background:#999;margin-left:2px;vertical-align:text-bottom;animation:blink 1s step-end infinite;}' +
    '@keyframes blink{0%,100%{opacity:1;}50%{opacity:0;}}' +
    /* Markdown styles */
    '.msg-bubble .md-h{margin:8px 0 4px;font-weight:600;line-height:1.3;}' +
    '.msg-bubble .md-h1{font-size:1.3em;}' +
    '.msg-bubble .md-h2{font-size:1.15em;}' +
    '.msg-bubble .md-h3{font-size:1.05em;}' +
    '.msg-bubble .md-h4,.msg-bubble .md-h5,.msg-bubble .md-h6{font-size:1em;}' +
    '.msg-bubble .md-p{margin:4px 0;}' +
    '.msg-bubble .md-ul,.msg-bubble .md-ol{margin:4px 0;padding-left:20px;}' +
    '.msg-bubble .md-ul li,.msg-bubble .md-ol li{margin:2px 0;}' +
    '.msg-bubble .md-blockquote{border-left:3px solid #ccc;margin:6px 0;padding:4px 10px;color:#666;background:rgba(0,0,0,0.03);border-radius:0 4px 4px 0;}' +
    '.msg-bubble .md-hr{border:none;border-top:1px solid #ddd;margin:8px 0;}' +
    '.msg-bubble .md-link{color:#667eea;text-decoration:underline;}' +
    '.msg-bubble .md-img{max-width:100%;border-radius:6px;margin:4px 0;}' +
    '.msg-bubble .md-inline-code{background:#e8e8e8;padding:1px 5px;border-radius:3px;font-family:Menlo,Monaco,Consolas,monospace;font-size:0.88em;}' +
    '.msg-bubble .md-code-block{background:#1e1e2e;color:#cdd6f4;border-radius:8px;margin:6px 0;overflow:hidden;font-size:0.85em;}' +
    '.msg-bubble .md-code-block .md-code-header{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;background:rgba(255,255,255,0.06);border-bottom:1px solid rgba(255,255,255,0.08);}' +
    '.msg-bubble .md-code-block .md-code-lang{font-size:11px;color:#89b4fa;font-family:inherit;}' +
    '.msg-bubble .md-code-block .md-copy-btn{background:rgba(255,255,255,0.1);border:none;color:#bac2de;font-size:11px;padding:2px 8px;border-radius:4px;cursor:pointer;font-family:inherit;}' +
    '.msg-bubble .md-code-block .md-copy-btn:hover{background:rgba(255,255,255,0.2);}' +
    '.msg-bubble .md-code-block code{display:block;padding:10px 12px;overflow-x:auto;white-space:pre;font-family:Menlo,Monaco,Consolas,monospace;line-height:1.5;}' +
    '.msg-bubble .md-table-wrap{overflow-x:auto;margin:6px 0;}' +
    '.msg-bubble .md-table{border-collapse:collapse;width:100%;font-size:0.9em;}' +
    '.msg-bubble .md-table th,.msg-bubble .md-table td{border:1px solid #ddd;padding:5px 8px;}' +
    '.msg-bubble .md-table th{background:#f0f0f0;font-weight:600;}' +
    '.msg-bubble .md-table tr:nth-child(even){background:rgba(0,0,0,0.02);}' +
    '.msg-bubble del{text-decoration:line-through;opacity:0.7;}' +
    /* User bubble overrides for markdown */
    '.chat-msg.user .msg-bubble .md-inline-code{background:rgba(255,255,255,0.2);}' +
    '.chat-msg.user .msg-bubble .md-link{color:#fff;text-decoration:underline;}' +
    '.chat-msg.user .msg-bubble .md-blockquote{border-left-color:rgba(255,255,255,0.4);color:rgba(255,255,255,0.85);background:rgba(255,255,255,0.08);}' +
    '.chat-msg.system{align-self:center;max-width:90%;text-align:center;}' +
    '.chat-msg.system .msg-bubble{background:#f0f0f0;color:#888;font-size:12px;padding:6px 14px;border-radius:12px;}' +
    '.chat-session-divider{display:flex;align-items:center;gap:12px;margin:16px 0;align-self:stretch;max-width:100%;}' +
    '.chat-session-divider::before,.chat-session-divider::after{content:"";flex:1;height:1px;background:#ddd;}' +
    '.chat-session-divider span{font-size:11px;color:#bbb;white-space:nowrap;}' +
    '.chat-msg.agent{align-self:flex-start;}' +
    '.chat-msg.agent .msg-avatar{background:linear-gradient(135deg,#43b581,#2d8b5e);color:white;}' +
    '.chat-msg.agent .msg-bubble{background:#e8f5e9;color:#333;border-bottom-left-radius:4px;}' +
    '#ai-chat-window .chat-header .header-handoff-btn,#ai-chat-window .chat-header .header-end-btn{display:none;}' +
    '#ai-chat-window .chat-action-bar{display:flex;gap:8px;padding:8px 16px;border-top:1px solid #eee;flex-shrink:0;background:#fafafa;}' +
    '#ai-chat-window .chat-action-bar .action-handoff-btn,#ai-chat-window .chat-action-bar .action-end-btn{flex:1;height:32px;border-radius:16px;border:1px solid #e0e0e0;background:white;cursor:pointer;font-size:12px;color:#555;transition:all .2s;}' +
    '#ai-chat-window .chat-action-bar .action-handoff-btn:hover{border-color:#667eea;color:#667eea;background:#f8f9ff;}' +
    '#ai-chat-window .chat-action-bar .action-end-btn:hover{border-color:#ea4335;color:#ea4335;background:#fff5f5;}' +
    '#ai-chat-window .chat-action-bar .action-handoff-btn:disabled{opacity:0.4;cursor:not-allowed;border-color:#e0e0e0;color:#999;background:#f5f5f5;}' +
    '#ai-chat-window .chat-action-bar .action-end-btn:disabled{opacity:0.4;cursor:not-allowed;border-color:#e0e0e0;color:#999;background:#f5f5f5;}' +
    /* Feedback card (satisfaction rating) */
    '.feedback-bubble{display:flex;flex-direction:column;gap:10px;min-width:240px;}' +
    '.feedback-title{font-size:13px;color:#333;font-weight:600;}' +
    '.feedback-stars{display:flex;gap:6px;}' +
    '.feedback-star{background:transparent;border:none;font-size:26px;line-height:1;color:#ddd;cursor:pointer;padding:0;transition:color .15s,transform .1s;}' +
    '.feedback-star:hover{transform:scale(1.1);}' +
    '.feedback-star.active{color:#fbbc04;}' +
    '.feedback-comment{width:100%;min-height:56px;max-height:100px;resize:vertical;border:1px solid #e0e0e0;border-radius:8px;padding:6px 8px;font-size:13px;font-family:inherit;box-sizing:border-box;background:#fff;}' +
    '.feedback-comment:focus{outline:none;border-color:' + pc + ';}' +
    '.feedback-actions{display:flex;justify-content:flex-end;gap:8px;}' +
    '.feedback-skip,.feedback-submit{border:none;border-radius:14px;padding:6px 14px;font-size:12px;cursor:pointer;transition:opacity .2s,transform .1s;}' +
    '.feedback-skip{background:#f0f0f0;color:#666;}' +
    '.feedback-skip:hover{background:#e4e4e4;}' +
    '.feedback-submit{background:linear-gradient(135deg,' + pc + ',#764ba2);color:#fff;}' +
    '.feedback-submit:hover:not([disabled]){transform:scale(1.03);}' +
    '.feedback-submit[disabled]{opacity:.5;cursor:not-allowed;}' +
    '@media(max-width:480px){#ai-chat-window{width:100vw;height:100vh;max-height:100vh;border-radius:0;bottom:0!important;left:0!important;right:0!important;}}';
  }

  /* ========== SVG Icons ========== */
  var ICON_CHAT = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  var ICON_BOT = '<svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zM7.5 13A1.5 1.5 0 006 14.5 1.5 1.5 0 007.5 16 1.5 1.5 0 009 14.5 1.5 1.5 0 007.5 13zm9 0a1.5 1.5 0 00-1.5 1.5 1.5 1.5 0 001.5 1.5 1.5 1.5 0 001.5-1.5 1.5 1.5 0 00-1.5-1.5zM10 17v2h4v-2h-4z"/></svg>';

  /* ========== Build DOM ========== */
  function buildWidget() {
    var bubble = document.createElement('div');
    bubble.id = 'ai-chat-bubble';
    bubble.setAttribute('role', 'button');
    bubble.setAttribute('aria-label', '打开 AI 聊天');
    bubble.setAttribute('tabindex', '0');
    bubble.innerHTML = '<span class="bubble-icon">' + ICON_CHAT + '</span><span class="unread-dot"></span>';
    positionBubble(bubble);

    var win = document.createElement('div');
    win.id = 'ai-chat-window';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', 'AI 聊天窗口');

    win.innerHTML =
      '<div class="chat-header">' +
        '<div class="header-avatar">' + ICON_BOT + '</div>' +
        '<div class="header-info">' +
          '<div class="header-title">' + escapeHtml(config.title) + '</div>' +
          '<div class="header-subtitle">' + escapeHtml(config.subtitle) + '</div>' +
        '</div>' +
        '<button class="header-handoff-btn" id="ai-chat-handoff" style="display:none;">转人工</button>' +
        '<button class="header-end-btn" id="ai-chat-end-session" style="display:none;">结束会话</button>' +
        '<button class="header-close" aria-label="关闭聊天">' + ICON_CLOSE + '</button>' +
      '</div>' +
      '<div class="chat-messages" id="ai-chat-messages"></div>' +
      '<div class="chat-action-bar" id="ai-chat-action-bar">' +
        '<button class="action-handoff-btn" id="ai-chat-handoff-bar">转人工</button>' +
        '<button class="action-end-btn" id="ai-chat-end-bar">结束会话</button>' +
      '</div>' +
      '<div class="chat-input-area">' +
        '<textarea id="ai-chat-input" rows="1" placeholder="' + escapeHtml(config.placeholder) + '" aria-label="输入消息"></textarea>' +
        '<button class="send-btn" id="ai-chat-send" aria-label="发送消息">' + ICON_SEND + '</button>' +
      '</div>' +
      '<div class="chat-footer">Powered by AI</div>';

    document.body.appendChild(bubble);
    document.body.appendChild(win);

    setupBubbleDrag(bubble);
    setupBubbleClick(bubble, win);
    setupCloseBtn(win);
    setupInput(win);
    setupKeyboard(bubble, win);

    var handoffBtn = document.getElementById('ai-chat-handoff-bar');
    if (handoffBtn) {
      handoffBtn.addEventListener('click', function () {
        requestHandoff();
      });
    }
    var endSessionBtn = document.getElementById('ai-chat-end-bar');
    if (endSessionBtn) {
      endSessionBtn.addEventListener('click', function () {
        tryEndSession();
      });
    }

    if (config.welcomeMessage) {
      appendMessageDOM('bot', config.welcomeMessage, true);
    }
    addQuickActions();
  }

  function positionBubble(bubble) {
    bubble.style.bottom = config.bottomOffset + 'px';
    if (config.position === 'left') {
      bubble.style.left = config.sideOffset + 'px';
    } else {
      bubble.style.right = config.sideOffset + 'px';
    }
  }

  function positionWindow(win) {
    var bubble = document.getElementById('ai-chat-bubble');
    if (!bubble) return;
    var rect = bubble.getBoundingClientRect();
    var winW = 380;
    var winH = 560;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    if (vw <= 480) {
      win.style.bottom = '0';
      win.style.left = '0';
      win.style.right = '0';
      return;
    }

    var bottom = vh - rect.top + 12;
    var left = rect.left + rect.width / 2 - winW / 2;

    if (left + winW > vw - 16) left = vw - winW - 16;
    if (left < 16) left = 16;
    if (bottom + winH > vh - 16) bottom = 16;

    win.style.bottom = bottom + 'px';
    win.style.left = left + 'px';
    win.style.right = 'auto';
  }

  /* ========== Bubble Drag ========== */
  function setupBubbleDrag(bubble) {
    bubble.addEventListener('pointerdown', function (e) {
      isDragging = true;
      hasMoved = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      var rect = bubble.getBoundingClientRect();
      bubbleStartX = rect.left;
      bubbleStartY = rect.top;
      bubble.setPointerCapture(e.pointerId);
      bubble.style.transition = 'box-shadow .3s ease';
    });

    bubble.addEventListener('pointermove', function (e) {
      if (!isDragging) return;
      var dx = e.clientX - dragStartX;
      var dy = e.clientY - dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      if (!hasMoved) return;

      var newX = bubbleStartX + dx;
      var newY = bubbleStartY + dy;
      var maxX = window.innerWidth - config.bubbleSize;
      var maxY = window.innerHeight - config.bubbleSize;
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));

      bubble.style.left = newX + 'px';
      bubble.style.top = newY + 'px';
      bubble.style.right = 'auto';
      bubble.style.bottom = 'auto';
    });

    bubble.addEventListener('pointerup', function (e) {
      isDragging = false;
      bubble.style.transition = 'transform .3s ease, box-shadow .3s ease';
      bubble.releasePointerCapture(e.pointerId);
      if (hasMoved && isOpen) {
        positionWindow(document.getElementById('ai-chat-window'));
      }
    });
  }

  /* ========== Bubble Click & Toggle ========== */
  function setupBubbleClick(bubble, win) {
    bubble.addEventListener('click', function () {
      if (hasMoved) return;
      toggleChat(bubble, win);
    });
  }

  function toggleChat(bubble, win) {
    isOpen = !isOpen;
    if (isOpen) {
      // 如果上次会话已结束（评价后），先重置到新会话
      if (pendingSessionReset) {
        resetSession(true); // skipEndEvent=true，因为 session_end 已在 endSessionOnly 中上报
      }
      positionWindow(win);
      win.classList.add('visible');
      bubble.classList.add('open');
      bubble.querySelector('.bubble-icon').innerHTML = ICON_CLOSE;
      bubble.querySelector('.unread-dot').style.display = 'none';
      var input = document.getElementById('ai-chat-input');
      if (input) setTimeout(function () { input.focus(); }, 300);
      trackEvent({ type: 'chat_open' });
    } else {
      win.classList.remove('visible');
      bubble.classList.remove('open');
      bubble.querySelector('.bubble-icon').innerHTML = ICON_CHAT;
      trackEvent({ type: 'chat_close' });
    }
  }

  function setupCloseBtn(win) {
    var btn = win.querySelector('.header-close');
    btn.addEventListener('click', function () {
      var bubble = document.getElementById('ai-chat-bubble');
      toggleChat(bubble, win);
    });
  }

  function setupKeyboard(bubble, win) {
    bubble.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!hasMoved) toggleChat(bubble, win);
      }
    });
  }

  /* ========== Input ========== */
  function setupInput(win) {
    var textarea = win.querySelector('#ai-chat-input');
    var sendBtn = win.querySelector('#ai-chat-send');

    textarea.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
      sendBtn.classList.toggle('active', this.value.trim().length > 0);
    });

    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendBtn.addEventListener('click', sendMessage);
  }

  /* ========== Send Message & Streaming Response ========== */
  function ensureSessionStarted() {
    if (!sessionStarted) {
      sessionStarted = true;
      trackEvent({ type: 'session_start' });
    }
  }

  function sendMessage() {
    if (isSending) return;
    var input = document.getElementById('ai-chat-input');
    var text = input.value.trim();
    if (!text) return;

    ensureSessionStarted();

    isSending = true;
    var sendBtn = document.getElementById('ai-chat-send');
    sendBtn.disabled = true;

    // Remove quick actions if present
    var qa = document.getElementById('quick-actions');
    if (qa) qa.remove();

    // Add user message to UI and history
    appendMessageDOM('user', text);
    chatHistory.push({ text: text, isSelf: false }); // isSelf=false means user (not bot)

    // 埋点：用户消息（仅 AI 模式，human 模式由 /api/chat/message 存储）
    if (sessionMode !== 'human') {
      trackEvent({ type: 'message', role: 'user', content: text });
    }

    input.value = '';
    input.style.height = 'auto';
    sendBtn.classList.remove('active');

    // Show typing indicator
    showTyping();

    // If in human mode, send via human mode API
    if (sessionMode === 'human') {
      hideTyping();
      sendHumanModeMessage(text);
      isSending = false;
      sendBtn.disabled = false;
      return;
    }

    // Create a placeholder for streaming bot response
    var botMsgId = 'bot-msg-' + (++messageIdCounter);
    var streamingText = '';
    var sendStartTime = Date.now();

    streamChat(text,
      // onChunk
      function (chunk, fullText) {
        hideTyping();
        streamingText = fullText;
        updateOrCreateStreamMsg(botMsgId, fullText, true);
      },
      // onDone
      function (finalText) {
        hideTyping();
        var responseTimeMs = null;
        if (typeof sendStartTime === 'number' && isFinite(sendStartTime)) {
          var elapsed = Date.now() - sendStartTime;
          if (isFinite(elapsed) && !isNaN(elapsed)) {
            responseTimeMs = elapsed;
          }
        }
        if (!finalText) finalText = streamingText;
        if (finalText) {
          updateOrCreateStreamMsg(botMsgId, finalText, false);
          // Add bot response to history
          chatHistory.push({ text: finalText, isSelf: true }); // isSelf=true means bot
          // 埋点：机器人回复
          trackEvent({ type: 'message', role: 'bot', content: finalText, responseTimeMs: responseTimeMs });
        } else {
          updateOrCreateStreamMsg(botMsgId, '抱歉，我暂时无法回答，请稍后再试。', false);
          trackEvent({ type: 'error', errorType: 'empty_response', errorMessage: '机器人返回空回复' });
        }
        isSending = false;
        sendBtn.disabled = false;
      },
      // onError
      function (err) {
        hideTyping();
        console.error('[AI Chat Widget] Error:', err);
        updateOrCreateStreamMsg(botMsgId, '网络出错了，请检查网络后重试。', false);
        // 埋点：错误
        trackEvent({ type: 'error', errorType: 'chat_error', errorMessage: err.message || String(err) });
        isSending = false;
        sendBtn.disabled = false;
      }
    );
  }

  function updateOrCreateStreamMsg(msgId, text, isStreaming) {
    var container = document.getElementById('ai-chat-messages');
    var existing = document.getElementById(msgId);

    if (existing) {
      var bubble = existing.querySelector('.msg-bubble');
      bubble.innerHTML = formatContent(text) + (isStreaming ? '<span class="stream-cursor"></span>' : '');
      container.scrollTop = container.scrollHeight;
    } else {
      var div = document.createElement('div');
      div.className = 'chat-msg bot';
      div.id = msgId;

      var avatarContent = ICON_BOT;
      if (config.botAvatar) {
        avatarContent = '<img src="' + escapeHtml(config.botAvatar) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="bot">';
      }

      var timeStr = formatTime(new Date());
      div.innerHTML =
        '<div class="msg-avatar">' + avatarContent + '</div>' +
        '<div class="msg-content">' +
          '<div class="msg-bubble">' + formatContent(text) + (isStreaming ? '<span class="stream-cursor"></span>' : '') + '</div>' +
          '<div class="msg-time">' + timeStr + '</div>' +
        '</div>';

      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }
  }

  /* ========== Message DOM Helpers ========== */
  function appendMessageDOM(role, text, isWelcome) {
    var container = document.getElementById('ai-chat-messages');
    var div = document.createElement('div');
    div.className = 'chat-msg ' + role;

    var avatarContent;
    if (role === 'bot') {
      avatarContent = ICON_BOT;
      if (config.botAvatar) {
        avatarContent = '<img src="' + escapeHtml(config.botAvatar) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="bot">';
      }
    } else {
      avatarContent = '👤';
    }

    var timeStr = formatTime(new Date());
    div.innerHTML =
      '<div class="msg-avatar">' + avatarContent + '</div>' +
      '<div class="msg-content">' +
        '<div class="msg-bubble">' + formatContent(text) + '</div>' +
        '<div class="msg-time">' + timeStr + '</div>' +
      '</div>';

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    if (!isOpen && !isWelcome) {
      var dot = document.querySelector('#ai-chat-bubble .unread-dot');
      if (dot) dot.style.display = 'block';
    }
  }

  function showTyping() {
    var container = document.getElementById('ai-chat-messages');
    if (document.getElementById('typing-msg')) return;
    var div = document.createElement('div');
    div.className = 'chat-msg bot';
    div.id = 'typing-msg';
    div.innerHTML =
      '<div class="msg-avatar">' + ICON_BOT + '</div>' +
      '<div class="msg-content"><div class="msg-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div></div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function hideTyping() {
    var el = document.getElementById('typing-msg');
    if (el) el.remove();
  }

  function appendSystemMessage(text) {
    var container = document.getElementById('ai-chat-messages');
    var div = document.createElement('div');
    div.className = 'chat-msg system';
    div.innerHTML =
      '<div class="msg-content" style="width:100%;text-align:center;">' +
        '<div class="msg-bubble" style="display:inline-block;">' + escapeHtml(text) + '</div>' +
      '</div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function addQuickActions() {
    var container = document.getElementById('ai-chat-messages');
    var div = document.createElement('div');
    div.className = 'quick-actions';
    div.id = 'quick-actions';
    var actions = config.presetQuestions || ['你能做什么？', '帮我写代码', '解释一个概念', '翻译文本'];
    if (actions.length === 0) return;
    actions.forEach(function (text) {
      var btn = document.createElement('button');
      btn.textContent = text;
      btn.addEventListener('click', function () {
        trackEvent({ type: 'quick_action_click', data: { text: text } });
        var input = document.getElementById('ai-chat-input');
        input.value = text;
        input.dispatchEvent(new Event('input'));
        sendMessage();
      });
      div.appendChild(btn);
    });
    container.appendChild(div);
  }

  /* ========== Utilities ========== */
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ========== Markdown Renderer ========== */
  function formatContent(text) {
    return renderMarkdown(text);
  }

  function renderMarkdown(src) {
    // Protect code blocks first, replace them with placeholders
    var codeBlocks = [];
    // Fenced code blocks: ```lang\n...\n```
    src = src.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
      var idx = codeBlocks.length;
      codeBlocks.push('<pre class="md-code-block"><div class="md-code-header">' +
        (lang ? '<span class="md-code-lang">' + escapeHtml(lang) + '</span>' : '') +
        '<button class="md-copy-btn" onclick="(function(b){var c=b.parentElement.nextElementSibling;var t=c.textContent;navigator.clipboard.writeText(t).then(function(){b.textContent=\'已复制\';setTimeout(function(){b.textContent=\'复制\'},1500)});})(this)">复制</button>' +
        '</div><code>' + escapeHtml(code) + '</code></pre>');
      return '\x00CODEBLOCK' + idx + '\x00';
    });

    // Inline code: `...`
    var inlineCodes = [];
    src = src.replace(/`([^`\n]+)`/g, function (_, code) {
      var idx = inlineCodes.length;
      inlineCodes.push('<code class="md-inline-code">' + escapeHtml(code) + '</code>');
      return '\x00INLINE' + idx + '\x00';
    });

    // Now process line by line
    var lines = src.split('\n');
    var html = '';
    var inList = false;
    var inOrderedList = false;
    var inBlockquote = false;
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      // Horizontal rule
      if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line.trim())) {
        if (inList) { html += '</ul>'; inList = false; }
        if (inOrderedList) { html += '</ol>'; inOrderedList = false; }
        if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }
        html += '<hr class="md-hr">';
        i++; continue;
      }

      // Headers: # ## ### etc
      var headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        if (inList) { html += '</ul>'; inList = false; }
        if (inOrderedList) { html += '</ol>'; inOrderedList = false; }
        if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }
        var level = headerMatch[1].length;
        html += '<h' + level + ' class="md-h md-h' + level + '">' + inlineFormat(headerMatch[2]) + '</h' + level + '>';
        i++; continue;
      }

      // Blockquote: > text
      var bqMatch = line.match(/^>\s?(.*)$/);
      if (bqMatch) {
        if (inList) { html += '</ul>'; inList = false; }
        if (inOrderedList) { html += '</ol>'; inOrderedList = false; }
        if (!inBlockquote) { html += '<blockquote class="md-blockquote">'; inBlockquote = true; }
        html += inlineFormat(bqMatch[1]) + '<br>';
        i++; continue;
      } else if (inBlockquote) {
        html += '</blockquote>'; inBlockquote = false;
      }

      // Unordered list: - item or * item or • item
      var ulMatch = line.match(/^[\s]*[-*•]\s+(.+)$/);
      if (ulMatch) {
        if (inOrderedList) { html += '</ol>'; inOrderedList = false; }
        if (!inList) { html += '<ul class="md-ul">'; inList = true; }
        html += '<li>' + inlineFormat(ulMatch[1]) + '</li>';
        i++; continue;
      } else if (inList) {
        html += '</ul>'; inList = false;
      }

      // Ordered list: 1. item
      var olMatch = line.match(/^[\s]*(\d+)[.)]\s+(.+)$/);
      if (olMatch) {
        if (inList) { html += '</ul>'; inList = false; }
        if (!inOrderedList) { html += '<ol class="md-ol">'; inOrderedList = true; }
        html += '<li>' + inlineFormat(olMatch[2]) + '</li>';
        i++; continue;
      } else if (inOrderedList) {
        html += '</ol>'; inOrderedList = false;
      }

      // Table detection
      if (line.indexOf('|') !== -1 && i + 1 < lines.length && /^\|?[\s-:|]+\|?$/.test(lines[i + 1].trim())) {
        var tableHtml = parseTable(lines, i);
        if (tableHtml.html) {
          html += tableHtml.html;
          i = tableHtml.endIndex;
          continue;
        }
      }

      // Empty line = paragraph break
      if (line.trim() === '') {
        html += '<br>';
        i++; continue;
      }

      // Normal paragraph
      html += '<p class="md-p">' + inlineFormat(line) + '</p>';
      i++;
    }

    // Close any open lists
    if (inList) html += '</ul>';
    if (inOrderedList) html += '</ol>';
    if (inBlockquote) html += '</blockquote>';

    // Restore code blocks
    for (var c = 0; c < codeBlocks.length; c++) {
      html = html.replace('\x00CODEBLOCK' + c + '\x00', codeBlocks[c]);
    }
    for (var d = 0; d < inlineCodes.length; d++) {
      html = html.replace('\x00INLINE' + d + '\x00', inlineCodes[d]);
    }

    return html;
  }

  function inlineFormat(text) {
    var s = escapeHtml(text);
    // Bold + Italic: ***text*** or ___text___
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
    // Bold: **text** or __text__
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic: *text* or _text_
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');
    // Strikethrough: ~~text~~
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
    // Links: [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>');
    // Images: ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="md-img">');
    // Restore inline code placeholders (they survive escapeHtml because they use \x00)
    // They'll be restored in the main function
    return s;
  }

  function parseTable(lines, startIdx) {
    var headerLine = lines[startIdx].trim();
    var sepLine = lines[startIdx + 1].trim();

    // Validate separator line
    if (!/^\|?[\s-:|]+\|?$/.test(sepLine)) return { html: '', endIndex: startIdx + 1 };

    var headers = splitTableRow(headerLine);
    var aligns = sepLine.split('|').filter(function (c) { return c.trim(); }).map(function (c) {
      c = c.trim();
      if (c[0] === ':' && c[c.length - 1] === ':') return 'center';
      if (c[c.length - 1] === ':') return 'right';
      return 'left';
    });

    var html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
    for (var h = 0; h < headers.length; h++) {
      html += '<th style="text-align:' + (aligns[h] || 'left') + '">' + inlineFormat(headers[h]) + '</th>';
    }
    html += '</tr></thead><tbody>';

    var idx = startIdx + 2;
    while (idx < lines.length && lines[idx].trim() && lines[idx].indexOf('|') !== -1) {
      var cells = splitTableRow(lines[idx].trim());
      html += '<tr>';
      for (var c = 0; c < headers.length; c++) {
        html += '<td style="text-align:' + (aligns[c] || 'left') + '">' + inlineFormat(cells[c] || '') + '</td>';
      }
      html += '</tr>';
      idx++;
    }

    html += '</tbody></table></div>';
    return { html: html, endIndex: idx };
  }

  function splitTableRow(row) {
    if (row[0] === '|') row = row.substring(1);
    if (row[row.length - 1] === '|') row = row.substring(0, row.length - 1);
    return row.split('|').map(function (c) { return c.trim(); });
  }

  function formatTime(date) {
    var h = date.getHours();
    var m = date.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /* ========== Server Base URL Helper ========== */
  function getServerBaseUrl() {
    try {
      var url = new URL(config.trackingEndpoint);
      return url.origin;
    } catch (e) {
      // Fallback: strip path manually
      var endpoint = config.trackingEndpoint;
      var protoEnd = endpoint.indexOf('://');
      if (protoEnd === -1) return endpoint;
      var pathStart = endpoint.indexOf('/', protoEnd + 3);
      if (pathStart === -1) return endpoint;
      return endpoint.substring(0, pathStart);
    }
  }

  /* ========== Handoff: 转人工 ========== */
  function requestHandoff() {
    // 确保 session_start 事件已上报，session 在数据库中存在
    flushTrackQueue();
    var handoffUrl = config.trackingEndpoint.replace('/api/track/collect', '/api/track/handoff');
    var userId = getOrCreateUserId();

    function doHandoff(retryCount) {
      fetch(handoffUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId, userId: userId })
      })
      .then(function (res) {
        if (res.status === 404 && retryCount < 2) {
          // session 可能还未入库，等待后重试
          setTimeout(function () { doHandoff(retryCount + 1); }, 1000);
          return;
        }
        if (!res.ok) throw new Error('Handoff failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data) return; // 重试中，跳过
        sessionMode = 'human';
        appendSystemMessage('已转接人工客服，请稍候...');
        var handoffBtn = document.getElementById('ai-chat-handoff-bar');
        if (handoffBtn) handoffBtn.disabled = true;
        startPolling();
        trackEvent({ type: 'handoff_to_human', sessionId: sessionId });
      })
      .catch(function () {
        appendSystemMessage('转接人工客服失败，请稍后重试');
      });
    }

    doHandoff(0);
  }

  /* ========== Polling: 轮询新消息 ========== */
  function startPolling() {
    if (pollingTimer) clearInterval(pollingTimer);
    pollingFailCount = 0;
    pollingTimer = setInterval(function () {
      pollNewMessages();
    }, POLLING_INTERVAL);
  }

  function pollNewMessages() {
    var baseUrl = getServerBaseUrl();
    var url = baseUrl + '/api/admin/sessions/' + encodeURIComponent(sessionId) + '/new-messages?afterId=' + lastMessageId;

    fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })
    .then(function (res) {
      if (!res.ok) throw new Error('Poll failed: ' + res.status);
      return res.json();
    })
    .then(function (data) {
      pollingFailCount = 0;
      // Restore normal interval if it was slowed down
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = setInterval(function () {
          pollNewMessages();
        }, POLLING_INTERVAL);
      }
      var messages = (data && data.data) ? data.data : (Array.isArray(data) ? data : []);
      for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        if (msg.role === 'agent') {
          appendAgentMessage(msg.content);
        }
        if (msg.id && msg.id > lastMessageId) {
          lastMessageId = msg.id;
        }
      }
    })
    .catch(function () {
      pollingFailCount++;
      if (pollingFailCount >= POLLING_FAIL_THRESHOLD) {
        appendSystemMessage('连接中断，正在重试...');
        if (pollingTimer) clearInterval(pollingTimer);
        pollingTimer = setInterval(function () {
          pollNewMessages();
        }, POLLING_SLOW_INTERVAL);
      }
    });
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
    pollingFailCount = 0;
  }

  function appendAgentMessage(text) {
    var container = document.getElementById('ai-chat-messages');
    var div = document.createElement('div');
    div.className = 'chat-msg agent';
    var timeStr = formatTime(new Date());
    div.innerHTML =
      '<div class="msg-avatar">🎧</div>' +
      '<div class="msg-content">' +
        '<div class="msg-bubble">' + formatContent(text) + '</div>' +
        '<div class="msg-time">' + timeStr + '</div>' +
      '</div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  /* ========== Human Mode Message ========== */
  function sendHumanModeMessage(text) {
    var baseUrl = getServerBaseUrl();
    var url = baseUrl + '/api/chat/message';
    var payload = JSON.stringify({
      sessionId: sessionId,
      userId: getOrCreateUserId(),
      content: text
    });

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    })
    .then(function (res) {
      if (!res.ok) throw new Error('Send failed: ' + res.status);
      return res.json();
    })
    .then(function () {
      // 消息已通过 /api/chat/message 存入数据库，无需再通过埋点重复存储
    })
    .catch(function () {
      appendSystemMessage('消息发送失败，请重试');
    });
  }

  /* ========== End Session: 满意度评价 ========== */
  function feedbackStorageKey() {
    return 'ai_chat_feedback_' + sessionId;
  }

  function tryEndSession() {
    // 本次会话已评价 → 直接重置，不弹评价卡
    var alreadyRated = false;
    try { alreadyRated = !!sessionStorage.getItem(feedbackStorageKey()); } catch (e) {}
    if (alreadyRated) {
      resetSession();
      return;
    }
    // 确保 session 已上报到后端
    ensureSessionStarted();
    flushTrackQueue();
    if (document.getElementById('feedback-card')) return;
    trackEvent({ type: 'end_session_click' });
    setEndSessionBtnDisabled(true);
    appendFeedbackCard();
  }

  function setEndSessionBtnDisabled(disabled) {
    var btn = document.getElementById('ai-chat-end-bar');
    if (btn) btn.disabled = !!disabled;
  }

  function appendFeedbackCard() {
    var container = document.getElementById('ai-chat-messages');
    if (!container) return;
    var qa = document.getElementById('quick-actions');
    if (qa) qa.remove();

    var div = document.createElement('div');
    div.className = 'chat-msg bot feedback-msg';
    div.id = 'feedback-card';
    div.innerHTML =
      '<div class="msg-avatar">' + ICON_BOT + '</div>' +
      '<div class="msg-content">' +
        '<div class="msg-bubble feedback-bubble">' +
          '<div class="feedback-title">感谢您本次的使用，请为我们的服务打分</div>' +
          '<div class="feedback-stars" id="feedback-stars">' +
            '<button type="button" class="feedback-star" data-v="1" aria-label="1 星">★</button>' +
            '<button type="button" class="feedback-star" data-v="2" aria-label="2 星">★</button>' +
            '<button type="button" class="feedback-star" data-v="3" aria-label="3 星">★</button>' +
            '<button type="button" class="feedback-star" data-v="4" aria-label="4 星">★</button>' +
            '<button type="button" class="feedback-star" data-v="5" aria-label="5 星">★</button>' +
          '</div>' +
          '<textarea class="feedback-comment" id="feedback-comment" maxlength="500" placeholder="欢迎留下您的建议（选填）"></textarea>' +
          '<div class="feedback-actions">' +
            '<button type="button" class="feedback-skip" id="feedback-skip">跳过</button>' +
            '<button type="button" class="feedback-submit" id="feedback-submit" disabled>提交</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    bindFeedbackHandlers();
  }

  function bindFeedbackHandlers() {
    var rating = 0;
    var stars = document.querySelectorAll('#feedback-stars .feedback-star');
    var submitBtn = document.getElementById('feedback-submit');
    var skipBtn = document.getElementById('feedback-skip');

    stars.forEach(function (btn) {
      btn.addEventListener('click', function () {
        rating = Number(btn.getAttribute('data-v'));
        stars.forEach(function (b, i) { b.classList.toggle('active', i < rating); });
        submitBtn.disabled = false;
      });
      btn.addEventListener('mouseenter', function () {
        var hv = Number(btn.getAttribute('data-v'));
        stars.forEach(function (b, i) { b.classList.toggle('active', i < hv); });
      });
      btn.addEventListener('mouseleave', function () {
        stars.forEach(function (b, i) { b.classList.toggle('active', i < rating); });
      });
    });

    skipBtn.addEventListener('click', function () {
      try { sessionStorage.setItem(feedbackStorageKey(), 'skipped'); } catch (e) {}
      var card = document.getElementById('feedback-card');
      if (card) card.remove();
      trackEvent({ type: 'feedback_skip' });
      endSessionOnly();
    });

    submitBtn.addEventListener('click', function () {
      if (!rating) return;
      var commentEl = document.getElementById('feedback-comment');
      var comment = commentEl ? commentEl.value.trim() : '';
      submitBtn.disabled = true;
      submitBtn.textContent = '提交中...';
      submitFeedback(rating, comment).then(function () {
        try { sessionStorage.setItem(feedbackStorageKey(), String(rating)); } catch (e) {}
        var card = document.getElementById('feedback-card');
        if (card) card.remove();
        appendSystemMessage('感谢您的评价！');
        endSessionOnly();
      }).catch(function (err) {
        console.warn('[AI Chat Widget] 提交评价失败:', err);
        submitBtn.disabled = false;
        submitBtn.textContent = '提交';
        appendSystemMessage('提交失败，请稍后重试');
      });
    });
  }

  function disableSessionInput(disabled) {
    var ta = document.getElementById('ai-chat-input');
    var sb = document.getElementById('ai-chat-send');
    var eb = document.getElementById('ai-chat-end-bar');
    var hb = document.getElementById('ai-chat-handoff-bar');
    if (ta) {
      ta.disabled = !!disabled;
      if (disabled) ta.placeholder = '本次会话已结束';
      else ta.placeholder = config.placeholder;
    }
    if (sb) sb.disabled = !!disabled;
    if (eb) eb.disabled = !!disabled;
    if (hb) hb.disabled = !!disabled;
  }

  function endSessionOnly() {
    stopPolling();
    trackEvent({ type: 'session_end' });
    disableSessionInput(true);
    pendingSessionReset = true;
    // 延迟 800ms 让用户看到"感谢评价"后再自动折叠窗口
    setTimeout(function () {
      if (!isOpen) return;
      var bubble = document.getElementById('ai-chat-bubble');
      var win = document.getElementById('ai-chat-window');
      if (bubble && win) toggleChat(bubble, win);
    }, 800);
  }

  function submitFeedback(rating, comment) {
    var base = (config.trackingEndpoint || '').replace(/\/collect\/?$/, '');
    var url = base ? (base + '/feedback') : '/api/track/feedback';
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionId,
        userId: getOrCreateUserId(),
        rating: rating,
        comment: comment
      })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      if (data && data.code !== 0) throw new Error(data.message || 'server error');
      return data;
    });
  }

  /* ========== Reset Session: 结束会话 ========== */
  function resetSession(skipEndEvent) {
    stopPolling();
    if (!skipEndEvent) {
      trackEvent({ type: 'session_end' });
    }
    sessionId = generateSessionId();
    chatHistory = [];
    sessionMode = 'ai';
    lastMessageId = 0;
    pendingSessionReset = false;
    disableSessionInput(false);
    var handoffBtn = document.getElementById('ai-chat-handoff-bar');
    if (handoffBtn) handoffBtn.disabled = false;

    // 不清空聊天记录，插入分隔线标识新会话
    var container = document.getElementById('ai-chat-messages');
    if (container) {
      // 移除旧的快捷操作
      var qa = document.getElementById('quick-actions');
      if (qa) qa.remove();
      // 插入分隔线
      var divider = document.createElement('div');
      divider.className = 'chat-session-divider';
      divider.innerHTML = '<span>以上为历史对话</span>';
      container.appendChild(divider);
    }

    if (config.welcomeMessage) {
      appendMessageDOM('bot', config.welcomeMessage, true);
    }
    addQuickActions();
    sessionStarted = false;
    trackEvent({ type: 'session_reset' });
  }

  /* ========== Fetch Agent Config from Server ========== */
  function getAgentConfigUrl(agentId) {
    // 如果配置了 agentConfigEndpoint，直接使用
    if (config.agentConfigEndpoint) {
      return config.agentConfigEndpoint.replace('{agentId}', agentId || 'default');
    }
    // 否则根据 trackingEndpoint 推断服务器地址
    var base = config.trackingEndpoint || '';
    var serverBase = base.replace(/\/api\/track\/collect\/?$/, '');
    if (!serverBase) return null;
    if (agentId) {
      return serverBase + '/api/agents/' + agentId + '/config';
    }
    return serverBase + '/api/agents/default/config';
  }

  function fetchAgentConfig(agentId) {
    var url = getAgentConfigUrl(agentId);
    if (!url) return Promise.resolve(null);

    return fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.code !== 0 || !data.data) return null;
        return data.data;
      })
      .catch(function (err) {
        console.warn('[AI Chat Widget] 获取智能体配置失败:', err.message);
        return null;
      });
  }

  function applyAgentConfig(agentConfig) {
    if (!agentConfig) return;
    // 展示类字段：只要远程有值就覆盖（允许空字符串覆盖默认值）
    if ('name' in agentConfig) config.title = agentConfig.name || config.title;
    if ('subtitle' in agentConfig) config.subtitle = agentConfig.subtitle || config.subtitle;
    if ('welcome_message' in agentConfig) config.welcomeMessage = agentConfig.welcome_message;
    if ('primary_color' in agentConfig && agentConfig.primary_color) config.primaryColor = agentConfig.primary_color;
    if ('preset_questions' in agentConfig && Array.isArray(agentConfig.preset_questions)) {
      config.presetQuestions = agentConfig.preset_questions;
    }
    // 凭证类字段：只有非空才覆盖（避免清空本地默认凭证）
    if (agentConfig.bot_id) config.botId = agentConfig.bot_id;
    if (agentConfig.access_key_id) config.accessKeyId = agentConfig.access_key_id;
    if (agentConfig.access_key_secret) config.accessKeySecret = agentConfig.access_key_secret;
    if (agentConfig.api_base) config.apiBase = agentConfig.api_base;
    if (agentConfig.agent_id) config.agentId = agentConfig.agent_id;
  }

  function rebuildWidget() {
    var oldStyle = document.getElementById('ai-chat-widget-styles');
    if (oldStyle) oldStyle.remove();
    injectStyles();
    var oldBubble = document.getElementById('ai-chat-bubble');
    var oldWin = document.getElementById('ai-chat-window');
    if (oldBubble) oldBubble.remove();
    if (oldWin) oldWin.remove();
    chatHistory = [];
    messageIdCounter = 0;
    isOpen = false;
    isSending = false;
    sessionMode = 'ai';
    lastMessageId = 0;
    pollingFailCount = 0;
    pendingSessionReset = false;
    stopPolling();
    sessionId = generateSessionId();
    accessToken = null;
    tokenExpiresAt = 0;
    sessionStarted = false;
    buildWidget();
  }

  /* ========== Public API ========== */
  window.AIChatWidget = {
    init: function (userConfig) {
      // 标记 init 已调用，阻止 autoInit 的构建
      widgetBuilt = true;
      if (userConfig) {
        Object.keys(userConfig).forEach(function (k) {
          config[k] = userConfig[k];
        });
      }

      // 始终尝试从服务器拉取智能体配置
      var agentId = config.agentId;
      fetchAgentConfig(agentId).then(function (agentConfig) {
        applyAgentConfig(agentConfig);
        rebuildWidget();
        getAccessToken().catch(function () {});
      });
    },
    switchAgent: function (agentId) {
      if (!agentId) return;
      fetchAgentConfig(agentId).then(function (agentConfig) {
        if (!agentConfig) {
          console.warn('[AI Chat Widget] 智能体不存在或已停用: ' + agentId);
          return;
        }
        applyAgentConfig(agentConfig);
        accessToken = null;
        tokenExpiresAt = 0;
        rebuildWidget();
        trackEvent({ type: 'agent_switch', data: { agentId: agentId } });
        getAccessToken().catch(function () {});
      });
    },
    open: function () {
      if (!isOpen) {
        var bubble = document.getElementById('ai-chat-bubble');
        var win = document.getElementById('ai-chat-window');
        if (bubble && win) toggleChat(bubble, win);
      }
    },
    close: function () {
      if (isOpen) {
        var bubble = document.getElementById('ai-chat-bubble');
        var win = document.getElementById('ai-chat-window');
        if (bubble && win) toggleChat(bubble, win);
      }
    },
    sendMessage: function (text) {
      if (!isOpen) this.open();
      var input = document.getElementById('ai-chat-input');
      if (input) {
        input.value = text;
        input.dispatchEvent(new Event('input'));
        sendMessage();
      }
    },
    clearHistory: function () {
      chatHistory = [];
      sessionId = generateSessionId();
      sessionStarted = false;
      var container = document.getElementById('ai-chat-messages');
      if (container) container.innerHTML = '';
      if (config.welcomeMessage) {
        appendMessageDOM('bot', config.welcomeMessage, true);
      }
      addQuickActions();
    },
    destroy: function () {
      stopPolling();
      var bubble = document.getElementById('ai-chat-bubble');
      var win = document.getElementById('ai-chat-window');
      var style = document.getElementById('ai-chat-widget-styles');
      if (bubble) bubble.remove();
      if (win) win.remove();
      if (style) style.remove();
      chatHistory = [];
      isOpen = false;
      accessToken = null;
      tokenExpiresAt = 0;
      sessionMode = 'ai';
      lastMessageId = 0;
    }
  };

  /* ========== Auto Init ========== */
  function autoInit() {
    sessionId = generateSessionId();
    getOrCreateUserId();

    // 始终尝试从服务器拉取智能体配置（指定 agentId 或默认智能体）
    var agentId = config.agentId;
    fetchAgentConfig(agentId).then(function (agentConfig) {
      // 如果 init() 已被手动调用，跳过 autoInit 的构建
      if (widgetBuilt) return;
      widgetBuilt = true;
      applyAgentConfig(agentConfig);
      injectStyles();
      buildWidget();
      getAccessToken().catch(function (err) {
        console.warn('[AI Chat Widget] Pre-auth failed, will retry on first message:', err.message);
      });
    });

    // 页面关闭时上报剩余事件
    window.addEventListener('beforeunload', function () {
      trackEvent({ type: 'session_end' });
      flushTrackQueue();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

})();
