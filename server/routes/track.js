const express = require('express');
const router = express.Router();
const db = require('../db');

// ========== 预编译 SQL ==========

const upsertUser = db.prepare(`
  INSERT INTO users (user_id, device_type, browser, os)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET last_seen_at = datetime('now')
`);

const insertSession = db.prepare(`
  INSERT OR IGNORE INTO sessions (session_id, user_id, bot_id, page_url, referrer, device_type, browser, os)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertMessage = db.prepare(`
  INSERT INTO messages (session_id, user_id, role, content, response_time_ms)
  VALUES (?, ?, ?, ?, ?)
`);

const updateSessionMsgCount = db.prepare(`
  UPDATE sessions SET message_count = message_count + 1 WHERE session_id = ?
`);

const insertEvent = db.prepare(`
  INSERT INTO events (user_id, session_id, event_type, event_data, page_url)
  VALUES (?, ?, ?, ?, ?)
`);

const insertError = db.prepare(`
  INSERT INTO errors (user_id, session_id, error_type, error_message)
  VALUES (?, ?, ?, ?)
`);

const endSession = db.prepare(`
  UPDATE sessions SET ended_at = datetime('now') WHERE session_id = ?
`);

// ========== 上报接口：批量接收埋点数据 ==========

router.post('/collect', (req, res) => {
  const { userId, sessionId, botId, pageUrl, referrer, device, events } = req.body;

  if (!userId || !Array.isArray(events)) {
    return res.status(400).json({ code: -1, message: '参数缺失' });
  }

  const deviceType = device?.type || 'unknown';
  const browser = device?.browser || 'unknown';
  const os = device?.os || 'unknown';

  try {
    const runAll = db.transaction(() => {
      // 更新用户
      upsertUser.run(userId, deviceType, browser, os);

      for (const evt of events) {
        switch (evt.type) {
          case 'session_start':
            insertSession.run(sessionId, userId, botId || '', pageUrl || '', referrer || '', deviceType, browser, os);
            break;

          case 'session_end':
            endSession.run(sessionId);
            break;

          case 'message':
            insertMessage.run(sessionId, userId, evt.role, evt.content || '', evt.responseTimeMs || null);
            updateSessionMsgCount.run(sessionId);
            break;

          case 'error':
            insertError.run(userId, sessionId, evt.errorType || 'unknown', evt.errorMessage || '');
            break;

          default:
            // 通用事件：chat_open, chat_close, quick_action_click 等
            insertEvent.run(userId, sessionId || '', evt.type, JSON.stringify(evt.data || {}), pageUrl || '');
            break;
        }
      }
    });

    runAll();
    res.json({ code: 0, message: 'ok' });
  } catch (err) {
    console.error('[Track] collect error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

module.exports = router;
