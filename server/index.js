const express = require('express');
const cors = require('cors');
const path = require('path');

const trackRoutes = require('./routes/track');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3200;

// 中间件
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// 静态文件：管理后台页面
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// API 路由
app.use('/api/track', trackRoutes);    // 埋点上报
app.use('/api/admin', adminRoutes);    // 管理后台接口

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[Chat Admin] 服务已启动: http://localhost:${PORT}`);
  console.log(`[Chat Admin] 管理后台: http://localhost:${PORT}/admin`);
  console.log(`[Chat Admin] 埋点接口: POST http://localhost:${PORT}/api/track/collect`);
});
