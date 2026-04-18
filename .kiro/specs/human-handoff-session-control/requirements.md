# Requirements Document

## Introduction

本功能为现有 AI 聊天悬浮球组件新增「转人工」和「结束会话」两个操作按钮。「转人工」允许用户将当前会话从 AI 模式切换为人工客服模式，此时 AI 停止自动回复，由管理后台的人工客服实时接管对话。「结束会话」允许用户主动结束当前会话并创建一个全新的 AI 对话窗口。同时，管理后台需要新增一个「人工客服」页面，客服人员可在该页面查看待处理的转人工会话并实时回复用户消息。数据统计逻辑也需要相应更新，以区分 AI 会话与人工会话的指标。

## Glossary

- **Chat_Widget**: 前端聊天悬浮球组件（chat-widget.js），基于纯 JavaScript IIFE 模式实现，负责用户端的聊天界面渲染、消息收发和埋点上报
- **Admin_Panel**: 管理后台 SPA 应用（admin/），基于纯 JavaScript 实现，提供数据概览、会话记录、用户管理、错误日志等功能
- **Backend**: Express.js 后端服务（server/），提供 REST API 接口，连接 MySQL 数据库
- **Session**: 一次完整的聊天会话，由 sessionId 唯一标识，包含多条消息记录
- **Human_Agent**: 在管理后台操作的人工客服人员，负责接管转人工会话并回复用户消息
- **Handoff**: 将会话从 AI 自动回复模式转交给人工客服处理的操作
- **Polling**: 客户端定时向服务端请求新数据的机制，用于实现近实时的消息更新效果

## Requirements

### Requirement 1: 转人工按钮

**User Story:** 作为用户，我希望在聊天窗口中点击「转人工」按钮，以便在 AI 无法满足需求时获得人工客服的帮助。

#### Acceptance Criteria

1. THE Chat_Widget SHALL 在聊天窗口的头部区域（header）显示一个「转人工」按钮
2. WHEN 用户点击「转人工」按钮, THE Chat_Widget SHALL 向 Backend 发送一个转人工请求，包含当前 sessionId 和 userId
3. WHEN Backend 收到转人工请求, THE Backend SHALL 将该 session 的状态更新为 "human"，并记录转人工时间戳
4. WHEN 转人工请求成功返回, THE Chat_Widget SHALL 在聊天窗口中显示一条系统提示消息「已转接人工客服，请稍候...」
5. WHILE 会话处于 "human" 状态, THE Chat_Widget SHALL 禁止调用 AI 流式接口（streamChat），用户发送的消息仅通过 Backend 存储
6. WHILE 会话处于 "human" 状态, THE Chat_Widget SHALL 将「转人工」按钮置为禁用状态，防止重复点击
7. WHEN 转人工请求失败, THE Chat_Widget SHALL 在聊天窗口中显示一条错误提示消息「转接人工客服失败，请稍后重试」
8. THE Chat_Widget SHALL 上报一个 event_type 为 "handoff_to_human" 的埋点事件，包含 sessionId

### Requirement 2: 人工客服消息收发

**User Story:** 作为用户，我希望在转人工后能实时收到人工客服的回复消息，以便获得即时帮助。

#### Acceptance Criteria

1. WHILE 会话处于 "human" 状态, THE Chat_Widget SHALL 通过 Polling 机制每 3 秒向 Backend 请求该 session 的新消息
2. WHEN Polling 返回新的人工客服消息, THE Chat_Widget SHALL 将消息以 "agent" 角色样式渲染到聊天窗口中，与 AI 消息和用户消息在视觉上有所区分
3. WHILE 会话处于 "human" 状态, THE Chat_Widget SHALL 允许用户正常输入和发送消息
4. WHEN 用户在 "human" 状态下发送消息, THE Chat_Widget SHALL 将消息通过 Backend API 存储到 messages 表，role 设为 "user"
5. THE Backend SHALL 提供一个 GET 接口用于获取指定 session 中在指定消息 ID 之后的新消息列表
6. IF Polling 请求连续失败 3 次, THEN THE Chat_Widget SHALL 在聊天窗口中显示一条提示「连接中断，正在重试...」并将 Polling 间隔延长至 10 秒

### Requirement 3: 结束会话按钮

**User Story:** 作为用户，我希望点击「结束会话」按钮后能开始一个全新的 AI 对话，以便重新开始咨询。

#### Acceptance Criteria

1. THE Chat_Widget SHALL 在聊天窗口的头部区域（header）显示一个「结束会话」按钮
2. WHEN 用户点击「结束会话」按钮, THE Chat_Widget SHALL 向 Backend 上报 session_end 事件以结束当前会话
3. WHEN 当前会话成功结束, THE Chat_Widget SHALL 生成一个新的 sessionId，清空聊天记录和对话历史（chatHistory）
4. WHEN 新会话创建完成, THE Chat_Widget SHALL 显示欢迎消息和快捷操作按钮，恢复为 AI 对话模式
5. WHEN 新会话创建完成, THE Chat_Widget SHALL 向 Backend 上报 session_start 事件
6. WHILE 会话处于 "human" 状态, WHEN 用户点击「结束会话」按钮, THE Chat_Widget SHALL 停止 Polling 并将会话模式重置为 AI 模式
7. THE Chat_Widget SHALL 上报一个 event_type 为 "session_reset" 的埋点事件

### Requirement 4: 管理后台人工客服页面

**User Story:** 作为人工客服，我希望在管理后台看到所有转人工的会话列表，并能实时回复用户消息，以便高效处理用户咨询。

#### Acceptance Criteria

1. THE Admin_Panel SHALL 在侧边栏导航中新增一个「人工客服」菜单项，图标为 🎧
2. WHEN Human_Agent 进入「人工客服」页面, THE Admin_Panel SHALL 显示所有状态为 "human" 的会话列表，按转人工时间倒序排列
3. THE Admin_Panel SHALL 在会话列表中显示每个会话的用户 ID、消息数、转人工时间和最后一条消息的预览
4. WHEN Human_Agent 点击某个会话, THE Admin_Panel SHALL 展示该会话的完整聊天记录，包含用户消息、AI 消息和人工客服消息
5. THE Admin_Panel SHALL 在聊天记录下方提供一个消息输入框和发送按钮，供 Human_Agent 输入回复
6. WHEN Human_Agent 点击发送按钮, THE Admin_Panel SHALL 将消息通过 Backend API 存储到 messages 表，role 设为 "agent"
7. WHILE Human_Agent 正在查看某个会话, THE Admin_Panel SHALL 通过 Polling 机制每 3 秒刷新聊天记录以显示用户的新消息
8. THE Admin_Panel SHALL 在会话列表中标注有未读新消息的会话

### Requirement 5: 后端 API 扩展

**User Story:** 作为开发者，我希望后端提供转人工、消息收发和会话状态管理的 API，以便前端和管理后台能正确实现功能。

#### Acceptance Criteria

1. THE Backend SHALL 在 sessions 表中新增 status 字段（VARCHAR），默认值为 "ai"，可选值为 "ai" 和 "human"
2. THE Backend SHALL 在 sessions 表中新增 handoff_at 字段（DATETIME），记录转人工的时间
3. THE Backend SHALL 提供 POST /api/track/handoff 接口，接收 sessionId 和 userId 参数，将 session 状态更新为 "human" 并设置 handoff_at
4. WHEN /api/track/handoff 接口收到的 sessionId 不存在, THE Backend SHALL 返回 HTTP 404 和错误信息
5. THE Backend SHALL 提供 GET /api/admin/sessions/:sessionId/new-messages?afterId=N 接口，返回指定 session 中 id 大于 N 的消息列表
6. THE Backend SHALL 提供 POST /api/admin/sessions/:sessionId/reply 接口，接收 content 参数，将消息以 role="agent" 存入 messages 表
7. THE Backend SHALL 在 messages 表的 role 字段中新增 "agent" 可选值，用于标识人工客服消息
8. THE Backend SHALL 提供 GET /api/admin/sessions/human 接口，返回所有 status 为 "human" 的会话列表
9. WHEN 用户在 "human" 状态下发送消息, THE Backend SHALL 提供 POST /api/chat/message 接口，接收 sessionId、userId 和 content 参数，将消息存入 messages 表

### Requirement 6: 数据统计更新

**User Story:** 作为管理员，我希望数据统计能区分 AI 会话和人工会话的指标，以便准确评估客服效率和 AI 覆盖率。

#### Acceptance Criteria

1. THE Backend SHALL 在概览统计接口（/api/admin/stats/overview）中新增 totalHumanSessions 字段，统计所有转人工的会话总数
2. THE Backend SHALL 在概览统计接口中新增 todayHumanSessions 字段，统计今日转人工的会话数
3. THE Backend SHALL 在概览统计接口中新增 humanHandoffRate 字段，计算转人工率（转人工会话数 / 总会话数）
4. THE Admin_Panel SHALL 在数据概览页面新增「转人工会话」和「转人工率」统计卡片
5. THE Backend SHALL 在趋势数据接口（/api/admin/stats/trend）中新增每日转人工会话数（humanSessions）字段
6. THE Admin_Panel SHALL 在趋势表格中新增「转人工数」列
7. THE Backend SHALL 在会话列表接口（/api/admin/sessions）的返回数据中包含 status 和 handoff_at 字段
8. THE Admin_Panel SHALL 在会话记录列表中显示会话状态标签（AI / 人工）
