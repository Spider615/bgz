# Implementation Plan: Human Handoff & Session Control

## Overview

本实现计划将「转人工」和「结束会话」功能分解为增量式编码任务。从数据库 schema 变更开始，然后实现后端 API，最后完成前端 Chat Widget 和管理后台的 UI 变更。每个任务构建在前一个任务之上，确保无孤立代码。

## Tasks

- [ ] 1. 数据库 Schema 变更与迁移
  - [x] 1.1 更新 `server/db.js` 中的 `initDB` 函数，扩展数据库表结构
    - 修改 `sessions` 表的 `CREATE TABLE` 语句，新增 `status VARCHAR(10) NOT NULL DEFAULT 'ai'` 和 `handoff_at DATETIME DEFAULT NULL` 字段，以及 `idx_sessions_status` 和 `idx_sessions_handoff_at` 索引
    - 修改 `messages` 表的 `CREATE TABLE` 语句，将 `role ENUM('user','bot')` 扩展为 `ENUM('user','bot','agent','system')`
    - 在 `initDB` 函数末尾新增 `migrateDB(conn)` 调用，用于对已有数据库执行增量迁移：检查 `sessions` 表是否存在 `status` 字段，若不存在则 `ALTER TABLE` 添加 `status`、`handoff_at` 字段及索引；检查 `messages` 表 `role` 字段是否包含 `agent`，若不包含则 `ALTER TABLE MODIFY COLUMN` 扩展 ENUM
    - _Requirements: 5.1, 5.2, 5.7_

  - [ ]* 1.2 编写数据库迁移的属性测试
    - **Property 1: Handoff updates session state** — 生成随机 sessionId，插入 session 后调用 handoff 更新，验证 status='human' 且 handoff_at 非空
    - **Validates: Requirements 1.3, 5.3**

- [ ] 2. 后端 API — 转人工与消息收发接口
  - [x] 2.1 在 `server/routes/track.js` 中新增 `POST /api/track/handoff` 接口
    - 接收 `sessionId` 和 `userId` 参数，校验非空（400 错误）
    - 查询 `sessions` 表确认 `sessionId` 存在（404 错误）
    - 执行 `UPDATE sessions SET status='human', handoff_at=NOW() WHERE session_id=?`
    - 在 `events` 表记录 `handoff_to_human` 事件
    - 返回 `{ code: 0, message: 'ok' }`
    - _Requirements: 5.3, 5.4, 1.3_

  - [x] 2.2 新建 `server/routes/chat.js`，实现 `POST /api/chat/message` 接口
    - 接收 `sessionId`、`userId`、`content` 参数，校验非空（400 错误）
    - 插入 `messages` 表：`role='user'`
    - 更新 `sessions` 表 `message_count = message_count + 1`
    - 返回 `{ code: 0, data: { id, created_at } }`
    - 在 `server/index.js` 中注册路由 `app.use('/api/chat', chatRoutes)`
    - _Requirements: 5.9, 2.4_

  - [x] 2.3 在 `server/routes/admin.js` 中新增三个接口
    - `GET /api/admin/sessions/human`：查询 `status='human'` 的会话列表，按 `handoff_at DESC` 排序，关联查询每个会话的最后一条消息预览和未读消息数（agent 最后回复之后的 user 消息数）
    - `GET /api/admin/sessions/:sessionId/new-messages?afterId=N`：返回指定 session 中 `id > afterId` 的消息列表，按 `id ASC` 排序；`afterId` 非数字时默认为 0
    - `POST /api/admin/sessions/:sessionId/reply`：接收 `content` 参数，校验非空（400）；查询 session 存在性（404）；从 session 获取 `user_id`；插入 `messages` 表 `role='agent'`；更新 `message_count`；返回 `{ code: 0, data: { id, created_at } }`
    - 注意：`GET /sessions/human` 路由必须定义在 `GET /sessions/:sessionId` 之前，避免路由冲突
    - _Requirements: 5.5, 5.6, 5.8, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 2.4 编写后端 API 属性测试 — 消息过滤
    - 在 `server/__tests__/new-messages.test.js` 中编写属性测试
    - **Property 3: New-messages endpoint filters by afterId** — 生成随机消息集合和 afterId，验证返回结果仅包含 id > afterId 的消息且按 id ASC 排序
    - **Validates: Requirements 2.5, 5.5**

  - [ ]* 2.5 编写后端 API 属性测试 — 消息存储角色保持
    - 在 `server/__tests__/message-storage.test.js` 中编写属性测试
    - **Property 6: Message storage preserves role** — 生成随机 content 字符串，通过 `/api/chat/message`（role=user）和 `/api/admin/sessions/:id/reply`（role=agent）存储后查询验证 role 和 content 一致
    - **Validates: Requirements 2.4, 4.6, 5.6, 5.9**

  - [ ]* 2.6 编写后端 API 属性测试 — 转人工会话过滤与排序
    - 在 `server/__tests__/human-sessions.test.js` 中编写属性测试
    - **Property 5: Human sessions filter and ordering** — 生成混合状态的会话集合，验证 `/api/admin/sessions/human` 仅返回 status='human' 的会话且按 handoff_at DESC 排序
    - **Validates: Requirements 4.2, 5.8**

- [x] 3. 检查点 — 确保后端所有测试通过
  - 运行 `npm test`（在 server 目录下），确保所有测试通过，如有问题请询问用户。

- [ ] 4. 后端 API — 统计接口扩展
  - [x] 4.1 扩展 `server/routes/admin.js` 中的 `GET /api/admin/stats/overview` 接口
    - 新增查询：`totalHumanSessions`（status='human' 的会话总数）、`todayHumanSessions`（今日转人工会话数，handoff_at >= CURDATE()）
    - 在返回数据中新增 `totalHumanSessions`、`todayHumanSessions`、`humanHandoffRate`（转人工率 = totalHumanSessions / totalSessions，totalSessions 为 0 时返回 0）
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 4.2 扩展 `server/routes/admin.js` 中的 `GET /api/admin/stats/trend` 接口
    - 在趋势查询中新增 LEFT JOIN，关联 `sessions` 表按 `DATE(handoff_at)` 分组统计 `human_count`
    - 返回每行新增 `humanSessions` 字段
    - _Requirements: 6.5_

  - [x] 4.3 扩展 `server/routes/admin.js` 中的 `GET /api/admin/sessions` 接口
    - 在会话列表查询的 SELECT 中新增 `s.status` 和 `s.handoff_at` 字段
    - _Requirements: 6.7_

  - [ ]* 4.4 编写统计接口属性测试
    - 在 `server/__tests__/stats.test.js` 中编写属性测试
    - **Property 7: Human session statistics accuracy** — 生成随机会话数据（混合 status 和 handoff_at），验证 overview 接口返回的 totalHumanSessions、todayHumanSessions、humanHandoffRate 数学正确
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [x] 5. 检查点 — 确保后端所有测试通过
  - 运行 `npm test`（在 server 目录下），确保所有测试通过，如有问题请询问用户。

- [ ] 6. 前端 Chat Widget — 转人工与结束会话功能
  - [x] 6.1 在 `chat-widget.js` 中新增闭包变量和辅助函数
    - 新增变量：`sessionMode = 'ai'`、`pollingTimer = null`、`lastMessageId = 0`、`pollingFailCount = 0`、`POLLING_INTERVAL = 3000`、`POLLING_SLOW_INTERVAL = 10000`、`POLLING_FAIL_THRESHOLD = 3`
    - 实现 `appendSystemMessage(text)` 函数：在聊天窗口中渲染系统提示消息，使用独特的样式（居中显示、灰色背景）区别于 user/bot/agent 消息
    - 在 `getCSS()` 中新增系统消息样式（`.chat-msg.system`）和 agent 消息样式（`.chat-msg.agent`），agent 消息使用绿色主题区分于 AI 蓝色
    - 在 `getCSS()` 中新增 header 按钮样式（`.header-handoff-btn`、`.header-end-btn`），与现有 `.header-close` 风格一致
    - _Requirements: 1.4, 2.2_

  - [x] 6.2 修改 `buildWidget()` 函数，在 chat-header 区域新增「转人工」和「结束会话」按钮
    - 在 `.header-close` 按钮之前插入两个按钮：`<button class="header-handoff-btn">转人工</button>` 和 `<button class="header-end-btn">结束会话</button>`
    - 为「转人工」按钮绑定 `requestHandoff()` 点击事件
    - 为「结束会话」按钮绑定 `resetSession()` 点击事件
    - _Requirements: 1.1, 3.1_

  - [x] 6.3 实现 `requestHandoff()` 函数 — 转人工请求
    - 调用 `POST /api/track/handoff`，发送 `{ sessionId, userId: getOrCreateUserId() }`
    - 成功后：将 `sessionMode` 设为 `'human'`；调用 `appendSystemMessage('已转接人工客服，请稍候...')`；将「转人工」按钮设为 disabled；调用 `startPolling()`；上报 `handoff_to_human` 埋点事件
    - 失败后：调用 `appendSystemMessage('转接人工客服失败，请稍后重试')`；不改变 `sessionMode`
    - _Requirements: 1.2, 1.3, 1.4, 1.6, 1.7, 1.8_

  - [x] 6.4 实现 Polling 机制 — `startPolling()`、`stopPolling()`、`pollNewMessages()`
    - `startPolling()`：清除已有 timer，重置 `pollingFailCount`，设置 `setInterval` 调用 `pollNewMessages()`，间隔为 `POLLING_INTERVAL`
    - `pollNewMessages()`：调用 `GET /api/admin/sessions/${sessionId}/new-messages?afterId=${lastMessageId}`；成功时重置 `pollingFailCount`，恢复 `POLLING_INTERVAL`，遍历新消息并以 agent 角色样式渲染到聊天窗口，更新 `lastMessageId`；失败时递增 `pollingFailCount`，达到 `POLLING_FAIL_THRESHOLD` 后显示「连接中断，正在重试...」提示并将间隔延长至 `POLLING_SLOW_INTERVAL`
    - `stopPolling()`：清除 timer，重置 `pollingFailCount`
    - _Requirements: 2.1, 2.2, 2.5, 2.6_

  - [x] 6.5 实现 `sendHumanModeMessage(text)` 并修改 `sendMessage()` 函数
    - `sendHumanModeMessage(text)`：调用 `POST /api/chat/message`，发送 `{ sessionId, userId: getOrCreateUserId(), content: text }`；成功后上报 message 埋点；失败后显示错误提示「消息发送失败，请重试」
    - 修改 `sendMessage()`：在发送逻辑中根据 `sessionMode` 分支 — 若为 `'ai'` 保持现有 `streamChat()` 逻辑，若为 `'human'` 调用 `sendHumanModeMessage()`
    - _Requirements: 1.5, 2.3, 2.4_

  - [x] 6.6 实现 `resetSession()` 函数 — 结束会话
    - 调用 `stopPolling()` 停止 Polling
    - 上报 `session_end` 事件（通过 `trackEvent`）
    - 生成新的 `sessionId`（调用 `generateSessionId()`）
    - 清空 `chatHistory` 数组和消息 DOM（`ai-chat-messages` 容器）
    - 重置 `sessionMode` 为 `'ai'`，重置 `lastMessageId` 为 0
    - 恢复「转人工」按钮为可用状态
    - 显示欢迎消息和快捷操作按钮（调用 `appendMessageDOM('bot', config.welcomeMessage, true)` 和 `addQuickActions()`）
    - 上报 `session_start` 和 `session_reset` 埋点事件
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 6.7 编写 Chat Widget 属性测试 — 会话重置
    - 在 `server/__tests__/session-reset.test.js` 中编写属性测试（测试纯逻辑函数）
    - **Property 4: Session reset produces fresh state** — 生成随机初始状态（sessionId、chatHistory 长度、sessionMode），验证 reset 后 sessionId 不同、chatHistory 为空、sessionMode 为 'ai'
    - **Validates: Requirements 3.3**

- [x] 7. 检查点 — 确保所有测试通过
  - 运行 `npm test`（在 server 目录下），确保所有测试通过，如有问题请询问用户。

- [ ] 8. 管理后台 — 人工客服页面
  - [x] 8.1 修改 `admin/index.html`，在侧边栏导航中新增「人工客服」菜单项
    - 在 `<nav>` 中 `errors` 菜单项之前插入：`<a data-page="human-service"><span class="icon">🎧</span><span>人工客服</span></a>`
    - 新增人工客服页面所需的 CSS 样式：左右分栏布局（会话列表 + 聊天面板）、agent 消息样式（绿色主题）、回复输入框样式、未读标记样式
    - _Requirements: 4.1_

  - [x] 8.2 修改 `admin/app.js`，扩展路由和渲染逻辑
    - 将 `validPages` 数组新增 `'human-service'`
    - 在 `renderPage` 的 switch 中新增 `case 'human-service': renderHumanService(); break;`
    - _Requirements: 4.1_

  - [x] 8.3 实现 `renderHumanService()` 函数 — 人工客服会话列表
    - 调用 `GET /api/admin/sessions/human` 获取转人工会话列表
    - 渲染左右分栏布局：左侧为会话列表，显示用户 ID、消息数、转人工时间、最后一条消息预览、未读标记
    - 会话列表为空时显示空状态「暂无转人工会话」
    - 点击会话项时调用 `renderHumanServiceChat(sessionId)` 在右侧面板显示聊天记录
    - _Requirements: 4.2, 4.3, 4.8_

  - [x] 8.4 实现 `renderHumanServiceChat(sessionId)` 函数 — 聊天面板与回复功能
    - 调用 `GET /api/admin/sessions/${sessionId}/messages` 获取完整聊天记录
    - 渲染聊天记录：区分 user（用户）、bot（AI）、agent（人工客服）三种角色样式
    - 底部渲染消息输入框和发送按钮
    - 发送按钮点击时调用 `POST /api/admin/sessions/${sessionId}/reply`，发送成功后将消息追加到聊天面板
    - 启动 3 秒 Polling（调用 `GET /api/admin/sessions/${sessionId}/new-messages?afterId=N`），自动刷新新消息
    - 切换会话或离开页面时停止 Polling
    - _Requirements: 4.4, 4.5, 4.6, 4.7_

- [ ] 9. 管理后台 — 数据统计页面更新
  - [x] 9.1 修改 `admin/app.js` 中的 `renderOverview()` 函数
    - 在统计卡片区域新增「转人工会话」卡片（显示 `totalHumanSessions`，子文本显示今日数 `todayHumanSessions`）
    - 新增「转人工率」卡片（显示 `humanHandoffRate` + '%'）
    - 在趋势表格的表头和数据行中新增「转人工数」列（显示 `humanSessions`）
    - _Requirements: 6.4, 6.6_

  - [x] 9.2 修改 `admin/app.js` 中的 `renderSessions()` 函数
    - 在会话列表表格中新增「状态」列
    - 根据 `status` 字段显示标签：`status === 'human'` 显示 `<span class="tag tag-red">人工</span>`，否则显示 `<span class="tag tag-blue">AI</span>`
    - _Requirements: 6.8_

  - [x] 9.3 修改 `admin/app.js` 中的 `renderSessionDetail()` 函数
    - 在聊天记录渲染中支持 `role === 'agent'` 的消息，使用绿色主题样式，角色标签显示「客服」
    - 支持 `role === 'system'` 的消息，使用居中灰色样式
    - _Requirements: 4.4_

- [x] 10. 最终检查点 — 确保所有测试通过
  - 运行 `npm test`（在 server 目录下），确保所有测试通过，如有问题请询问用户。

## Notes

- 标记 `*` 的任务为可选任务，可跳过以加快 MVP 进度
- 每个任务引用了具体的需求编号，确保可追溯性
- 检查点任务确保增量验证，避免问题累积
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 数据库迁移逻辑兼容全新安装和已有数据库升级两种场景
