const express = require('express');
const cors = require('cors');
const path = require('path');

const { initDB } = require('./db');
const trackRoutes = require('./routes/track');
const adminRoutes = require('./routes/admin');
const chatRoutes = require('./routes/chat');

const app = express();
const PORT = process.env.PORT || 3200;

// 中间件
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// 静态文件：管理后台页面
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// 静态文件：前端演示页面（index.html + chat-widget.js）
app.use(express.static(path.join(__dirname, '..')));

// API 路由
app.use('/api/track', trackRoutes);    // 埋点上报
app.use('/api/admin', adminRoutes);    // 管理后台接口
app.use('/api/chat', chatRoutes);      // 聊天消息接口

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 公开接口：获取默认智能体配置（必须在 :agentId 路由之前）
app.get('/api/agents/default/config', async (req, res) => {
  const { pool } = require('./db');
  try {
    const [[agent]] = await pool.query(
      `SELECT agent_id, name, subtitle, welcome_message, preset_questions, primary_color, bot_id, access_key_id, access_key_secret, api_base
       FROM agents WHERE is_default = 1 AND is_active = 1 LIMIT 1`
    );
    if (!agent) {
      return res.json({ code: 0, data: null });
    }
    agent.preset_questions = typeof agent.preset_questions === 'string'
      ? JSON.parse(agent.preset_questions)
      : (agent.preset_questions || []);
    res.json({ code: 0, data: agent });
  } catch (err) {
    console.error('[API] default agent config error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// 公开接口：获取智能体配置（供前端 widget 使用）
app.get('/api/agents/:agentId/config', async (req, res) => {
  const { pool } = require('./db');
  try {
    const [[agent]] = await pool.query(
      `SELECT agent_id, name, subtitle, welcome_message, preset_questions, primary_color, bot_id, access_key_id, access_key_secret, api_base
       FROM agents WHERE agent_id = ? AND is_active = 1`,
      [req.params.agentId]
    );
    if (!agent) {
      return res.status(404).json({ code: -1, message: '智能体不存在或已停用' });
    }
    agent.preset_questions = typeof agent.preset_questions === 'string'
      ? JSON.parse(agent.preset_questions)
      : (agent.preset_questions || []);
    res.json({ code: 0, data: agent });
  } catch (err) {
    console.error('[API] agent config error:', err);
    res.status(500).json({ code: -1, message: '服务器错误' });
  }
});

// 初始化数据库后启动服务
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`[Chat Admin] 服务已启动: http://localhost:${PORT}`);
    console.log(`[Chat Admin] 管理后台: http://localhost:${PORT}/admin`);
    console.log(`[Chat Admin] 埋点接口: POST http://localhost:${PORT}/api/track/collect`);
  });
}).catch(err => {
  console.error('[Chat Admin] 数据库初始化失败:', err);
  process.exit(1);
});
