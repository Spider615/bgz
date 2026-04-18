const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// ========== 用户消息发送接口（human 模式） ==========

router.post('/message', async (req, res) => {
  const { sessionId, userId, content } = req.body;

  if (!sessionId || !userId || !content) {
    return res.status(400).json({ code: -1, message: '参数缺失' });
  }

  const conn = await pool.getConnection();
  try {
    // 插入消息
    const [result] = await conn.query(
      `INSERT INTO messages (session_id, user_id, role, content) VALUES (?, ?, 'user', ?)`,
      [sessionId, userId, content]
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
    console.error('[Chat] message error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

module.exports = router;
