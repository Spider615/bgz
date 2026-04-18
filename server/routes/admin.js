const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// ========== 概览统计 ==========

router.get('/stats/overview', async (req, res) => {
  try {
    const [[{ count: totalUsers }]] = await pool.query('SELECT COUNT(*) as count FROM users');
    const [[{ count: totalSessions }]] = await pool.query('SELECT COUNT(*) as count FROM sessions');
    const [[{ count: totalMessages }]] = await pool.query('SELECT COUNT(*) as count FROM messages');
    const [[{ count: totalErrors }]] = await pool.query('SELECT COUNT(*) as count FROM errors');

    // 今日数据
    const [[{ count: todayUsers }]] = await pool.query(
      `SELECT COUNT(DISTINCT user_id) as count FROM sessions WHERE started_at >= CURDATE()`
    );
    const [[{ count: todaySessions }]] = await pool.query(
      `SELECT COUNT(*) as count FROM sessions WHERE started_at >= CURDATE()`
    );
    const [[{ count: todayMessages }]] = await pool.query(
      `SELECT COUNT(*) as count FROM messages WHERE created_at >= CURDATE()`
    );

    // 平均每会话消息数
    const [[{ avg: avgMessages }]] = await pool.query(
      `SELECT COALESCE(AVG(message_count), 0) as avg FROM sessions WHERE message_count > 0`
    );

    // 全量平均响应时长
    const [[{ avg: avgResponseTime }]] = await pool.query(
      `SELECT COALESCE(AVG(response_time_ms), 0) as avg FROM messages WHERE response_time_ms IS NOT NULL AND response_time_ms > 0`
    );

    // 当日平均响应时长
    const [[{ avg: todayAvgResponseTime }]] = await pool.query(
      `SELECT COALESCE(AVG(response_time_ms), 0) as avg FROM messages WHERE response_time_ms IS NOT NULL AND response_time_ms > 0 AND created_at >= CURDATE()`
    );

    // 7 日活跃用户
    const [[{ count: activeUsers7d }]] = await pool.query(
      `SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE role = 'user' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`
    );

    // 30 日活跃用户
    const [[{ count: activeUsers30d }]] = await pool.query(
      `SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE role = 'user' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
    );

    // 转人工会话统计
    const [[{ count: totalHumanSessions }]] = await pool.query(
      `SELECT COUNT(*) as count FROM sessions WHERE status = 'human'`
    );
    const [[{ count: todayHumanSessions }]] = await pool.query(
      `SELECT COUNT(*) as count FROM sessions WHERE status = 'human' AND handoff_at >= CURDATE()`
    );
    const humanHandoffRate = totalSessions > 0
      ? Math.round((totalHumanSessions / totalSessions) * 1000) / 10
      : 0;

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
        avgMessagesPerSession: Math.round(avgMessages * 10) / 10,
        avgResponseTimeMs: avgResponseTime,
        todayAvgResponseTimeMs: todayAvgResponseTime,
        activeUsers7d,
        activeUsers30d,
        totalHumanSessions,
        todayHumanSessions,
        humanHandoffRate
      }
    });
  } catch (err) {
    console.error('[Admin] overview error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// ========== 趋势数据（最近 N 天） ==========

router.get('/stats/trend', async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 90);

  try {
    const [trend] = await pool.query(`
      WITH RECURSIVE dates(d) AS (
        SELECT CURDATE() - INTERVAL ? DAY
        UNION ALL
        SELECT d + INTERVAL 1 DAY FROM dates WHERE d < CURDATE()
      )
      SELECT
        dates.d as date,
        COALESCE(u.user_count, 0) as users,
        COALESCE(s.session_count, 0) as sessions,
        COALESCE(m.msg_count, 0) as messages,
        COALESCE(rt.avg_rt, 0) as avgResponseTime,
        COALESCE(h.human_count, 0) as humanSessions
      FROM dates
      LEFT JOIN (
        SELECT DATE(started_at) as d, COUNT(DISTINCT user_id) as user_count
        FROM sessions GROUP BY DATE(started_at)
      ) u ON dates.d = u.d
      LEFT JOIN (
        SELECT DATE(started_at) as d, COUNT(*) as session_count
        FROM sessions GROUP BY DATE(started_at)
      ) s ON dates.d = s.d
      LEFT JOIN (
        SELECT DATE(created_at) as d, COUNT(*) as msg_count
        FROM messages GROUP BY DATE(created_at)
      ) m ON dates.d = m.d
      LEFT JOIN (
        SELECT DATE(created_at) as d,
               COALESCE(AVG(response_time_ms), 0) as avg_rt
        FROM messages
        WHERE response_time_ms IS NOT NULL AND response_time_ms > 0
        GROUP BY DATE(created_at)
      ) rt ON dates.d = rt.d
      LEFT JOIN (
        SELECT DATE(handoff_at) as d, COUNT(*) as human_count
        FROM sessions
        WHERE status = 'human' AND handoff_at IS NOT NULL
        GROUP BY DATE(handoff_at)
      ) h ON dates.d = h.d
      ORDER BY dates.d
    `, [days]);

    res.json({ code: 0, data: trend });
  } catch (err) {
    console.error('[Admin] trend error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// ========== 转人工会话列表 ==========
// 注意：此路由必须定义在 /sessions/:sessionId 之前，避免 Express 将 "human" 匹配为 :sessionId

router.get('/sessions/human', async (req, res) => {
  try {
    const [sessions] = await pool.query(`
      SELECT
        s.*,
        (SELECT content FROM messages WHERE session_id = s.session_id ORDER BY id DESC LIMIT 1) as last_message,
        (SELECT COUNT(*) FROM messages m
          WHERE m.session_id = s.session_id
            AND m.role = 'user'
            AND m.id > COALESCE(
              (SELECT MAX(m2.id) FROM messages m2 WHERE m2.session_id = s.session_id AND m2.role = 'agent'),
              0
            )
        ) as unread_count
      FROM sessions s
      WHERE s.status = 'human'
      ORDER BY s.handoff_at DESC
    `);

    res.json({ code: 0, data: sessions });
  } catch (err) {
    console.error('[Admin] human sessions error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// ========== 增量消息查询 ==========

router.get('/sessions/:sessionId/new-messages', async (req, res) => {
  const { sessionId } = req.params;
  const afterId = parseInt(req.query.afterId) || 0;

  try {
    const [messages] = await pool.query(
      `SELECT id, role, content, created_at FROM messages WHERE session_id = ? AND id > ? ORDER BY id ASC`,
      [sessionId, afterId]
    );

    res.json({ code: 0, data: messages });
  } catch (err) {
    console.error('[Admin] new-messages error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// ========== 客服回复接口 ==========

router.post('/sessions/:sessionId/reply', async (req, res) => {
  const { sessionId } = req.params;
  const { content } = req.body;

  if (!content) {
    return res.status(400).json({ code: -1, message: '参数缺失: content 为必填项' });
  }

  const conn = await pool.getConnection();
  try {
    // 查询 session 存在性并获取 user_id
    const [[session]] = await conn.query(
      `SELECT user_id FROM sessions WHERE session_id = ?`,
      [sessionId]
    );

    if (!session) {
      return res.status(404).json({ code: -1, message: '会话不存在' });
    }

    // 插入 agent 消息
    const [result] = await conn.query(
      `INSERT INTO messages (session_id, user_id, role, content) VALUES (?, ?, 'agent', ?)`,
      [sessionId, session.user_id, content]
    );

    // 更新会话消息计数
    await conn.query(
      `UPDATE sessions SET message_count = message_count + 1 WHERE session_id = ?`,
      [sessionId]
    );

    // 查询新插入消息的 created_at
    const [[msg]] = await conn.query(
      `SELECT created_at FROM messages WHERE id = ?`,
      [result.insertId]
    );

    res.json({
      code: 0,
      data: {
        id: result.insertId,
        created_at: msg.created_at
      }
    });
  } catch (err) {
    console.error('[Admin] reply error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// ========== 会话列表 ==========

router.get('/sessions', async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
  const offset = (page - 1) * pageSize;

  try {
    const [[{ count: total }]] = await pool.query('SELECT COUNT(*) as count FROM sessions');

    const [sessions] = await pool.query(`
      SELECT
        s.*,
        (SELECT COUNT(*) FROM messages WHERE session_id = s.session_id) as actual_msg_count,
        (SELECT ROUND(COALESCE(AVG(response_time_ms), 0)) FROM messages WHERE session_id = s.session_id AND response_time_ms IS NOT NULL AND response_time_ms > 0) as avg_response_time_ms
      FROM sessions s
      ORDER BY s.started_at DESC
      LIMIT ? OFFSET ?
    `, [pageSize, offset]);

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

router.get('/sessions/:sessionId/messages', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const [messages] = await pool.query(
      `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
      [sessionId]
    );

    res.json({ code: 0, data: messages });
  } catch (err) {
    console.error('[Admin] session messages error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// ========== 用户列表 ==========

router.get('/users', async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
  const offset = (page - 1) * pageSize;

  try {
    const [[{ count: total }]] = await pool.query('SELECT COUNT(*) as count FROM users');

    const [users] = await pool.query(`
      SELECT
        u.*,
        (SELECT COUNT(*) FROM sessions WHERE user_id = u.user_id) as session_count,
        (SELECT COUNT(*) FROM messages WHERE user_id = u.user_id) as message_count
      FROM users u
      ORDER BY u.last_seen_at DESC
      LIMIT ? OFFSET ?
    `, [pageSize, offset]);

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

router.get('/stats/events', async (req, res) => {
  try {
    const [events] = await pool.query(`
      SELECT event_type, COUNT(*) as count
      FROM events
      GROUP BY event_type
      ORDER BY count DESC
    `);

    res.json({ code: 0, data: events });
  } catch (err) {
    console.error('[Admin] events error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// ========== 错误列表 ==========

router.get('/errors', async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
  const offset = (page - 1) * pageSize;

  try {
    const [[{ count: total }]] = await pool.query('SELECT COUNT(*) as count FROM errors');

    const [errors] = await pool.query(
      `SELECT * FROM errors ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );

    res.json({
      code: 0,
      data: { total, page, pageSize, list: errors }
    });
  } catch (err) {
    console.error('[Admin] errors error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// ========== 智能体管理 ==========

// 获取所有智能体
router.get('/agents', async (req, res) => {
  try {
    const [agents] = await pool.query(
      `SELECT * FROM agents ORDER BY is_default DESC, created_at ASC`
    );
    // 解析 preset_questions JSON
    const list = agents.map(a => ({
      ...a,
      preset_questions: typeof a.preset_questions === 'string'
        ? JSON.parse(a.preset_questions)
        : (a.preset_questions || [])
    }));
    res.json({ code: 0, data: list });
  } catch (err) {
    console.error('[Admin] agents list error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// 获取单个智能体
router.get('/agents/:agentId', async (req, res) => {
  try {
    const [[agent]] = await pool.query(
      `SELECT * FROM agents WHERE agent_id = ?`,
      [req.params.agentId]
    );
    if (!agent) {
      return res.status(404).json({ code: -1, message: '智能体不存在' });
    }
    agent.preset_questions = typeof agent.preset_questions === 'string'
      ? JSON.parse(agent.preset_questions)
      : (agent.preset_questions || []);
    res.json({ code: 0, data: agent });
  } catch (err) {
    console.error('[Admin] agent detail error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// 创建智能体
router.post('/agents', async (req, res) => {
  const { name, subtitle, welcome_message, preset_questions, primary_color, bot_id, access_key_id, access_key_secret, api_base, is_default } = req.body;

  if (!name) {
    return res.status(400).json({ code: -1, message: '参数缺失: name 为必填项' });
  }

  const agentId = 'agent_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8);

  const conn = await pool.getConnection();
  try {
    // 如果设为默认，先取消其他默认
    if (is_default) {
      await conn.query(`UPDATE agents SET is_default = 0`);
    }

    await conn.query(
      `INSERT INTO agents (agent_id, name, subtitle, welcome_message, preset_questions, primary_color, bot_id, access_key_id, access_key_secret, api_base, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        agentId,
        name,
        subtitle || '随时为您解答',
        welcome_message || '',
        JSON.stringify(preset_questions || []),
        primary_color || '#667eea',
        bot_id || '',
        access_key_id || '',
        access_key_secret || '',
        api_base || 'https://insight.juzibot.com',
        is_default ? 1 : 0
      ]
    );

    res.json({ code: 0, data: { agent_id: agentId } });
  } catch (err) {
    console.error('[Admin] create agent error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// 更新智能体
router.put('/agents/:agentId', async (req, res) => {
  const { agentId } = req.params;
  const { name, subtitle, welcome_message, preset_questions, primary_color, bot_id, access_key_id, access_key_secret, api_base, is_default, is_active } = req.body;

  const conn = await pool.getConnection();
  try {
    const [[existing]] = await conn.query(`SELECT id FROM agents WHERE agent_id = ?`, [agentId]);
    if (!existing) {
      return res.status(404).json({ code: -1, message: '智能体不存在' });
    }

    // 如果设为默认，先取消其他默认
    if (is_default) {
      await conn.query(`UPDATE agents SET is_default = 0`);
    }

    const fields = [];
    const values = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (subtitle !== undefined) { fields.push('subtitle = ?'); values.push(subtitle); }
    if (welcome_message !== undefined) { fields.push('welcome_message = ?'); values.push(welcome_message); }
    if (preset_questions !== undefined) { fields.push('preset_questions = ?'); values.push(JSON.stringify(preset_questions)); }
    if (primary_color !== undefined) { fields.push('primary_color = ?'); values.push(primary_color); }
    if (bot_id !== undefined) { fields.push('bot_id = ?'); values.push(bot_id); }
    if (access_key_id !== undefined) { fields.push('access_key_id = ?'); values.push(access_key_id); }
    if (access_key_secret !== undefined) { fields.push('access_key_secret = ?'); values.push(access_key_secret); }
    if (api_base !== undefined) { fields.push('api_base = ?'); values.push(api_base); }
    if (is_default !== undefined) { fields.push('is_default = ?'); values.push(is_default ? 1 : 0); }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active ? 1 : 0); }

    if (fields.length === 0) {
      return res.status(400).json({ code: -1, message: '无更新字段' });
    }

    values.push(agentId);
    await conn.query(`UPDATE agents SET ${fields.join(', ')} WHERE agent_id = ?`, values);

    res.json({ code: 0, data: { agent_id: agentId } });
  } catch (err) {
    console.error('[Admin] update agent error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// 删除智能体
router.delete('/agents/:agentId', async (req, res) => {
  try {
    const [result] = await pool.query(`DELETE FROM agents WHERE agent_id = ?`, [req.params.agentId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ code: -1, message: '智能体不存在' });
    }
    res.json({ code: 0, data: null });
  } catch (err) {
    console.error('[Admin] delete agent error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

module.exports = router;
