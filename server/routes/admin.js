const express = require('express');
const router = express.Router();
const db = require('../db');

// ========== 概览统计 ==========

router.get('/stats/overview', (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalSessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
    const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
    const totalErrors = db.prepare('SELECT COUNT(*) as count FROM errors').get().count;

    // 今日数据
    const todayUsers = db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count FROM sessions
      WHERE started_at >= date('now')
    `).get().count;

    const todaySessions = db.prepare(`
      SELECT COUNT(*) as count FROM sessions
      WHERE started_at >= date('now')
    `).get().count;

    const todayMessages = db.prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE created_at >= date('now')
    `).get().count;

    // 平均每会话消息数
    const avgMessages = db.prepare(`
      SELECT COALESCE(AVG(message_count), 0) as avg FROM sessions WHERE message_count > 0
    `).get().avg;

    res.json({
      code: 0,
      data: {
        totalUsers,
        totalSessions,
        totalMessages,
        totalErrors,
        todayUsers,
        todaySessions,
        todayMessages,
        avgMessagesPerSession: Math.round(avgMessages * 10) / 10
      }
    });
  } catch (err) {
    console.error('[Admin] overview error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// ========== 趋势数据（最近 N 天） ==========

router.get('/stats/trend', (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 90);

  try {
    const trend = db.prepare(`
      WITH RECURSIVE dates(d) AS (
        SELECT date('now', '-' || ? || ' days')
        UNION ALL
        SELECT date(d, '+1 day') FROM dates WHERE d < date('now')
      )
      SELECT
        dates.d as date,
        COALESCE(u.user_count, 0) as users,
        COALESCE(s.session_count, 0) as sessions,
        COALESCE(m.msg_count, 0) as messages
      FROM dates
      LEFT JOIN (
        SELECT date(started_at) as d, COUNT(DISTINCT user_id) as user_count
        FROM sessions GROUP BY date(started_at)
      ) u ON dates.d = u.d
      LEFT JOIN (
        SELECT date(started_at) as d, COUNT(*) as session_count
        FROM sessions GROUP BY date(started_at)
      ) s ON dates.d = s.d
      LEFT JOIN (
        SELECT date(created_at) as d, COUNT(*) as msg_count
        FROM messages GROUP BY date(created_at)
      ) m ON dates.d = m.d
      ORDER BY dates.d
    `).all(days);

    res.json({ code: 0, data: trend });
  } catch (err) {
    console.error('[Admin] trend error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// ========== 会话列表 ==========

router.get('/sessions', (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
  const offset = (page - 1) * pageSize;

  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;

    const sessions = db.prepare(`
      SELECT
        s.*,
        (SELECT COUNT(*) FROM messages WHERE session_id = s.session_id) as actual_msg_count
      FROM sessions s
      ORDER BY s.started_at DESC
      LIMIT ? OFFSET ?
    `).all(pageSize, offset);

    res.json({
      code: 0,
      data: { total, page, pageSize, list: sessions }
    });
  } catch (err) {
    console.error('[Admin] sessions error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// ========== 某个会话的聊天记录 ==========

router.get('/sessions/:sessionId/messages', (req, res) => {
  const { sessionId } = req.params;

  try {
    const messages = db.prepare(`
      SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC
    `).all(sessionId);

    res.json({ code: 0, data: messages });
  } catch (err) {
    console.error('[Admin] session messages error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// ========== 用户列表 ==========

router.get('/users', (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
  const offset = (page - 1) * pageSize;

  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

    const users = db.prepare(`
      SELECT
        u.*,
        (SELECT COUNT(*) FROM sessions WHERE user_id = u.user_id) as session_count,
        (SELECT COUNT(*) FROM messages WHERE user_id = u.user_id) as message_count
      FROM users u
      ORDER BY u.last_seen_at DESC
      LIMIT ? OFFSET ?
    `).all(pageSize, offset);

    res.json({
      code: 0,
      data: { total, page, pageSize, list: users }
    });
  } catch (err) {
    console.error('[Admin] users error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// ========== 事件统计 ==========

router.get('/stats/events', (req, res) => {
  try {
    const events = db.prepare(`
      SELECT event_type, COUNT(*) as count
      FROM events
      GROUP BY event_type
      ORDER BY count DESC
    `).all();

    res.json({ code: 0, data: events });
  } catch (err) {
    console.error('[Admin] events error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// ========== 错误列表 ==========

router.get('/errors', (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
  const offset = (page - 1) * pageSize;

  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM errors').get().count;

    const errors = db.prepare(`
      SELECT * FROM errors ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(pageSize, offset);

    res.json({
      code: 0,
      data: { total, page, pageSize, list: errors }
    });
  } catch (err) {
    console.error('[Admin] errors error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

module.exports = router;
