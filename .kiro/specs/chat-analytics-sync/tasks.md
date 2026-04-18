# 实现计划：Chat Analytics Sync

## 概述

本实现计划基于需求文档和技术设计文档，将聊天悬浮球与管理后台之间的数据同步链路增强功能拆分为可递增执行的编码任务。每个任务在前一个任务的基础上构建，最终将所有组件串联起来。项目使用 JavaScript（前端 vanilla JS + 后端 Node.js/Express + MySQL），测试框架使用 Vitest + fast-check。

## 任务

- [x] 1. 搭建测试基础设施
  - 在 `server/` 目录下安装 `vitest` 和 `fast-check` 作为开发依赖
  - 在 `server/package.json` 中添加 `"test": "vitest --run"` 脚本
  - 创建 `server/vitest.config.js` 配置文件
  - 创建 `server/__tests__/` 测试目录
  - _需求: 全局_

- [ ] 2. 数据库索引优化
  - [x] 2.1 在 `server/db.js` 的 `initDB()` 函数中新增索引创建语句
    - 添加 `CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id)`
    - 添加 `CREATE INDEX IF NOT EXISTS idx_messages_response_time ON messages(response_time_ms)`
    - _需求: 设计文档 - 数据库索引优化_

- [ ] 3. Chat Widget 响应时长埋点增强
  - [x] 3.1 在 `chat-widget.js` 的 `sendMessage()` 函数中增加 `responseTimeMs` 防御性处理
    - 当 `sendStartTime` 无效（undefined/NaN）时，将 `responseTimeMs` 设为 `null`
    - 当计算结果为 NaN 或 Infinity 时，将 `responseTimeMs` 设为 `null`
    - _需求: 1.1, 1.3_

  - [ ]* 3.2 编写属性测试：响应时长计算正确性
    - **Property 1: 响应时长计算正确性**
    - 使用 fast-check 生成随机时间戳对（sendStartTime, completionTime），验证 `completionTime - sendStartTime` 为非负整数
    - 验证当 sendStartTime 无效时返回 null
    - **验证需求: 1.1**

- [ ] 4. Track API 参数校验增强
  - [x] 4.1 修改 `server/routes/track.js` 中的参数校验逻辑
    - 将现有的 `if (!userId || !Array.isArray(events))` 拆分为两个独立校验
    - 缺少 `userId` 时返回 HTTP 400 + `{ code: -1, message: '参数缺失: userId 为必填项' }`
    - `events` 不是数组或为空数组时返回 HTTP 400 + `{ code: -1, message: '参数缺失: events 必须为非空数组' }`
    - _需求: 6.4_

  - [ ]* 4.2 编写属性测试：缺失必要字段的请求被拒绝
    - **Property 5: 缺失必要字段的请求被拒绝**
    - 使用 fast-check 生成随机缺失字段的请求体，验证返回 HTTP 400 和描述性错误信息
    - 验证有效请求不会被拒绝
    - **验证需求: 6.4**

  - [ ]* 4.3 编写属性测试：Session Start 幂等性
    - **Property 4: Session Start 幂等性**
    - 使用 fast-check 生成随机 session_id，模拟重复 session_start 事件，验证数据库中只有一条记录
    - **验证需求: 6.3**

- [x] 5. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 6. Admin API 概览统计增强
  - [x] 6.1 在 `server/routes/admin.js` 的 `/stats/overview` 接口中新增平均响应时长查询
    - 添加全量平均响应时长查询：`SELECT COALESCE(AVG(response_time_ms), 0) FROM messages WHERE response_time_ms IS NOT NULL AND response_time_ms > 0`
    - 添加当日平均响应时长查询：同上条件加 `AND created_at >= CURDATE()`
    - 在返回数据中包含 `avgResponseTimeMs` 和 `todayAvgResponseTimeMs` 字段，无数据时返回 0
    - _需求: 2.1, 2.2, 2.3, 2.4_

  - [x] 6.2 在 `/stats/overview` 接口中新增活跃用户统计查询
    - 添加 7 日活跃用户查询：`SELECT COUNT(DISTINCT user_id) FROM messages WHERE role = 'user' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`
    - 添加 30 日活跃用户查询：同上，INTERVAL 改为 30 DAY
    - 在返回数据中包含 `activeUsers7d` 和 `activeUsers30d` 字段
    - _需求: 3.1, 3.2, 3.3_

  - [ ]* 6.3 编写属性测试：平均响应时长仅统计有效记录
    - **Property 2: 平均响应时长仅统计有效记录**
    - 使用 fast-check 生成包含 null、0、负数和正整数的 response_time_ms 值集合
    - 验证平均值仅基于 > 0 且非 null 的记录计算，无有效记录时返回 0
    - **验证需求: 2.1, 2.2, 2.3, 2.4, 5.1, 5.3**

  - [ ]* 6.4 编写属性测试：活跃用户按时间窗口去重计数
    - **Property 3: 活跃用户按时间窗口去重计数**
    - 使用 fast-check 生成随机用户消息集合（含不同 role 和日期），验证去重计数逻辑
    - 验证同一用户多条消息只计数一次，role='bot' 的消息不参与计数
    - **验证需求: 3.1, 3.2, 3.3**

- [ ] 7. Admin API 趋势数据增强
  - [x] 7.1 修改 `server/routes/admin.js` 的 `/stats/trend` 接口 SQL 查询
    - 在现有 CTE 查询中 LEFT JOIN 每日平均响应时长子查询
    - SELECT 中新增 `COALESCE(rt.avg_rt, 0) as avgResponseTime`
    - 某日无有效响应时长记录时返回 0
    - _需求: 5.1, 5.3_

- [ ] 8. 管理后台概览页展示增强
  - [x] 8.1 修改 `admin/app.js` 的 `renderOverview()` 函数，新增统计卡片
    - 添加"平均响应时长"卡片：显示 `Math.round(stats.avgResponseTimeMs)` + " ms"，副标题显示当日平均响应时长
    - 当 `avgResponseTimeMs > 5000` 时数值以红色显示
    - 添加"7 日活跃用户"卡片：显示 `stats.activeUsers7d`
    - 添加"30 日活跃用户"卡片：显示 `stats.activeUsers30d`
    - _需求: 4.1, 4.2, 4.3, 4.4_

  - [x] 8.2 修改 `renderOverview()` 中的趋势表格
    - 表头新增"平均响应时长"列
    - 单元格显示 `Math.round(row.avgResponseTime)` + " ms"
    - _需求: 5.2_

  - [x] 8.3 修改 `renderSessions()` 中的会话列表表格
    - 表头新增"结束时间"列
    - 单元格显示 `s.ended_at` 或 '-'（未结束的会话）
    - _需求: 8.4_

- [x] 9. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 10. 消息计数与会话生命周期验证
  - [ ]* 10.1 编写属性测试：消息实际计数一致性
    - **Property 6: 消息实际计数一致性**
    - 使用 fast-check 生成随机消息序列，验证 Admin API 返回的消息计数等于 messages 表中的实际记录数
    - **验证需求: 7.1, 7.2, 7.3**

  - [ ]* 10.2 编写属性测试：Session ID 唯一性
    - **Property 7: Session ID 唯一性**
    - 使用 fast-check 生成多次调用 `generateSessionId()`，验证所有生成的 ID 互不相同
    - **验证需求: 8.1**

  - [ ]* 10.3 编写属性测试：Session End 更新结束时间
    - **Property 8: Session End 更新结束时间**
    - 使用 fast-check 生成随机会话并发送 session_end 事件，验证 ended_at 从 null 变为非 null 的有效时间戳
    - **验证需求: 8.2, 8.3**

- [x] 11. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## 说明

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求编号以确保可追溯性
- 检查点任务确保增量验证
- 属性测试使用 fast-check 库验证通用正确性属性
- 单元测试验证具体示例和边界情况
- 项目使用 JavaScript（Node.js + Express + MySQL），前端为 vanilla JS
