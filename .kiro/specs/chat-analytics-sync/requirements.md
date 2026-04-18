# 需求文档

## 简介

本功能旨在完善聊天悬浮球（Chat Widget）与管理后台之间的对话数据同步链路。当前系统已具备基础的埋点上报（chat-widget.js → `/api/track/collect`）和后台展示能力，但在统计指标的完整性、数据准确性和实时性方面存在不足。本需求将补齐平均响应时长、活跃用户统计、消息趋势等关键分析指标，并确保前端埋点数据能可靠、完整地同步到管理后台。

## 术语表

- **Chat_Widget**: 嵌入在网页中的聊天悬浮球前端组件（chat-widget.js），负责用户交互和埋点数据上报
- **Track_API**: 后端埋点数据采集接口（`/api/track/collect`），负责接收并持久化 Chat_Widget 上报的事件数据
- **Admin_API**: 后端管理接口（`/api/admin/*`），负责聚合查询统计数据并提供给管理后台
- **Admin_Dashboard**: 管理后台前端页面（admin/），负责展示统计数据和会话记录
- **Session**: 一次完整的聊天会话，从用户打开聊天窗口到关闭或页面卸载
- **Response_Time**: 从用户发送消息到收到机器人完整回复的时间间隔（毫秒）
- **Active_User**: 在指定时间范围内至少发送过一条消息的独立用户

## 需求

### 需求 1：响应时长埋点上报

**用户故事：** 作为系统管理员，我想查看机器人的平均响应时长，以便评估 AI 服务的响应性能。

#### 验收标准

1. WHEN 机器人完成一条回复, THE Chat_Widget SHALL 在上报的 message 事件中包含 `responseTimeMs` 字段，其值为从用户消息发送到机器人回复完成的时间差（毫秒）
2. WHEN Track_API 接收到包含 `responseTimeMs` 的 message 事件, THE Track_API SHALL 将该值存储到 messages 表的 `response_time_ms` 列
3. IF Chat_Widget 无法计算响应时长, THEN THE Chat_Widget SHALL 将 `responseTimeMs` 设为 null 而非上报错误值

### 需求 2：平均响应时长统计接口

**用户故事：** 作为系统管理员，我想在管理后台看到平均响应时长指标，以便监控 AI 服务质量。

#### 验收标准

1. THE Admin_API SHALL 在 `/stats/overview` 接口的返回数据中包含 `avgResponseTimeMs` 字段，表示所有机器人回复的平均响应时长（毫秒）
2. WHEN 计算平均响应时长时, THE Admin_API SHALL 仅统计 `response_time_ms` 不为 null 且大于 0 的消息记录
3. THE Admin_API SHALL 在 `/stats/overview` 接口的返回数据中包含 `todayAvgResponseTimeMs` 字段，表示当日机器人回复的平均响应时长
4. IF 没有有效的响应时长记录, THEN THE Admin_API SHALL 返回 `avgResponseTimeMs` 为 0

### 需求 3：活跃用户统计

**用户故事：** 作为系统管理员，我想区分总用户数和活跃用户数，以便了解真实的用户参与度。

#### 验收标准

1. THE Admin_API SHALL 在 `/stats/overview` 接口的返回数据中包含 `activeUsers7d` 字段，表示最近 7 天内发送过消息的独立用户数
2. THE Admin_API SHALL 在 `/stats/overview` 接口的返回数据中包含 `activeUsers30d` 字段，表示最近 30 天内发送过消息的独立用户数
3. WHEN 统计活跃用户时, THE Admin_API SHALL 基于 messages 表中 role 为 'user' 的记录按 `user_id` 去重计数

### 需求 4：管理后台概览页展示增强

**用户故事：** 作为系统管理员，我想在概览页直观地看到所有关键统计指标，以便快速掌握系统运行状况。

#### 验收标准

1. THE Admin_Dashboard SHALL 在概览页的统计卡片区域展示平均响应时长指标，格式为毫秒值并保留整数
2. THE Admin_Dashboard SHALL 在概览页的统计卡片区域展示 7 日活跃用户数和 30 日活跃用户数
3. THE Admin_Dashboard SHALL 在概览页的统计卡片区域展示当日平均响应时长作为副标题信息
4. WHEN 平均响应时长超过 5000 毫秒时, THE Admin_Dashboard SHALL 将该指标的数值以红色显示以提示异常

### 需求 5：趋势数据增加响应时长维度

**用户故事：** 作为系统管理员，我想查看每日平均响应时长的变化趋势，以便发现性能退化问题。

#### 验收标准

1. THE Admin_API SHALL 在 `/stats/trend` 接口的每日数据中包含 `avgResponseTime` 字段，表示该日机器人回复的平均响应时长（毫秒）
2. THE Admin_Dashboard SHALL 在趋势表格中增加"平均响应时长"列，展示每日的平均响应时长
3. IF 某日没有有效的响应时长记录, THEN THE Admin_API SHALL 返回该日的 `avgResponseTime` 为 0

### 需求 6：埋点数据可靠性保障

**用户故事：** 作为系统管理员，我想确保埋点数据不会丢失，以便统计数据准确反映真实情况。

#### 验收标准

1. WHEN 页面即将卸载时, THE Chat_Widget SHALL 将队列中所有未发送的事件立即通过 `navigator.sendBeacon` 发送
2. WHEN `navigator.sendBeacon` 不可用时, THE Chat_Widget SHALL 使用 `fetch` 并设置 `keepalive: true` 作为降级方案
3. WHEN Track_API 接收到重复的 session_start 事件时, THE Track_API SHALL 忽略重复记录而非创建重复会话
4. WHEN Track_API 接收到缺少必要字段（userId 或 events）的请求时, THE Track_API SHALL 返回 HTTP 400 状态码和描述性错误信息

### 需求 7：会话消息计数准确性

**用户故事：** 作为系统管理员，我想确保会话的消息计数准确，以便统计数据可信。

#### 验收标准

1. WHEN Track_API 接收到 role 为 'user' 或 'bot' 的 message 事件时, THE Track_API SHALL 将 sessions 表中对应会话的 `message_count` 加 1
2. THE Admin_API SHALL 在会话列表中优先使用 messages 表的实际消息计数（`actual_msg_count`）而非 sessions 表的 `message_count` 字段
3. WHEN 查询会话列表时, THE Admin_API SHALL 通过子查询从 messages 表获取每个会话的实际消息数量

### 需求 8：数据同步的会话生命周期管理

**用户故事：** 作为系统管理员，我想了解每个会话的完整生命周期，以便分析用户行为模式。

#### 验收标准

1. WHEN Chat_Widget 初始化时, THE Chat_Widget SHALL 生成唯一的 session_id 并上报 `session_start` 事件
2. WHEN 用户关闭页面或导航离开时, THE Chat_Widget SHALL 上报 `session_end` 事件
3. WHEN Track_API 接收到 `session_end` 事件时, THE Track_API SHALL 更新 sessions 表中对应会话的 `ended_at` 字段为当前时间
4. THE Admin_Dashboard SHALL 在会话列表中展示会话的开始时间和结束时间
