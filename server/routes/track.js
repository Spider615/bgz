const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// ========== 上报接口：批量接收埋点数据 ==========

router.post('/collect', async (req, res) => {
  const { userId, sessionId, botId, pageUrl, referrer, device, events } = req.body;

  if (!userId) {
    return res.status(400).json({ code: -1, message: '参数缺失: userId 为必填项' });
  }
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ code: -1, message: '参数缺失: events 必须为非空数组' });
  }

  const deviceType = device?.type || 'unknown';
  const browser = device?.browser || 'unknown';
  const os = device?.os || 'unknown';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 更新用户
    await conn.query(
      `INSERT INTO users (user_id, device_type, browser, os)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_seen_at = NOW()`,
      [userId, deviceType, browser, os]
    );

    for (const evt of events) {
      switch (evt.type) {
        case 'session_start':
          await conn.query(
            `INSERT IGNORE INTO sessions (session_id, user_id, bot_id, page_url, referrer, device_type, browser, os)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [sessionId, userId, botId || '', pageUrl || '', referrer || '', deviceType, browser, os]
          );
          break;

        case 'session_end':
          await conn.query(
            `UPDATE sessions SET ended_at = NOW() WHERE session_id = ?`,
            [sessionId]
          );
          break;

        case 'message':
          await conn.query(
            `INSERT INTO messages (session_id, user_id, role, content, response_time_ms)
             VALUES (?, ?, ?, ?, ?)`,
            [sessionId, userId, evt.role, evt.content || '', evt.responseTimeMs || null]
          );
          await conn.query(
            `UPDATE sessions SET message_count = message_count + 1 WHERE session_id = ?`,
            [sessionId]
          );
          break;

        case 'error':
          await conn.query(
            `INSERT INTO errors (user_id, session_id, error_type, error_message)
             VALUES (?, ?, ?, ?)`,
            [userId, sessionId, evt.errorType || 'unknown', evt.errorMessage || '']
          );
          break;

        default:
          await conn.query(
            `INSERT INTO events (user_id, session_id, event_type, event_data, page_url)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, sessionId || '', evt.type, JSON.stringify(evt.data || {}), pageUrl || '']
          );
          break;
      }
    }

    await conn.commit();
    res.json({ code: 0, message: 'ok' });
  } catch (err) {
    await conn.rollback();
    console.error('[Track] collect error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// ========== 转人工接口 ==========

router.post('/handoff', async (req, res) => {
  const { sessionId, userId } = req.body;

  if (!sessionId || !userId) {
    return res.status(400).json({ code: -1, message: '参数缺失: sessionId 和 userId 为必填项' });
  }

  const conn = await pool.getConnection();
  try {
    // 查询 session 是否存在
    const [rows] = await conn.query(
      `SELECT session_id, user_id FROM sessions WHERE session_id = ?`,
      [sessionId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: -1, message: '会话不存在' });
    }

    // 更新会话状态为 human
    await conn.query(
      `UPDATE sessions SET status = 'human', handoff_at = NOW() WHERE session_id = ?`,
      [sessionId]
    );

    // 记录 handoff_to_human 事件
    await conn.query(
      `INSERT INTO events (user_id, session_id, event_type, event_data) VALUES (?, ?, ?, ?)`,
      [userId, sessionId, 'handoff_to_human', JSON.stringify({})]
    );

    res.json({ code: 0, message: 'ok' });
  } catch (err) {
    console.error('[Track] handoff error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// ========== 会话满意度评价接口 ==========

router.post('/feedback', async (req, res) => {
  const { sessionId, userId, rating, comment } = req.body;

  if (!sessionId || !userId) {
    return res.status(400).json({ code: -1, message: '参数缺失: sessionId 和 userId 为必填项' });
  }
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) {
    return res.status(400).json({ code: -1, message: 'rating 必须为 1-5 的整数' });
  }
  const c = typeof comment === 'string' ? comment.slice(0, 1000) : null;

  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO feedbacks (session_id, user_id, rating, comment)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment), created_at = NOW()`,
      [sessionId, userId, r, c]
    );
    await conn.query(
      `UPDATE sessions SET ended_at = NOW() WHERE session_id = ? AND ended_at IS NULL`,
      [sessionId]
    );
    res.json({ code: 0, message: 'ok' });
  } catch (err) {
    console.error('[Track] feedback error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

module.exports = router;
