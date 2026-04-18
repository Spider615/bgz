const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'chat_admin.db'));

// 开启 WAL 模式，提升并发读写性能
db.pragma('journal_mode = WAL');

// ========== 建表 ==========

db.exec(`
  -- 用户表：记录每个独立访客
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT UNIQUE NOT NULL,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    device_type TEXT,
    browser TEXT,
    os TEXT
  );

  -- 会话表：每次打开聊天窗口算一个会话
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    bot_id TEXT,
    page_url TEXT,
    referrer TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    message_count INTEGER DEFAULT 0,
    device_type TEXT,
    browser TEXT,
    os TEXT
  );

  -- 消息表：记录每条聊天内容
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'bot')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    response_time_ms INTEGER
  );

  -- 事件表：记录用户行为（打开聊天、点击快捷问题等）
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    session_id TEXT,
    event_type TEXT NOT NULL,
    event_data TEXT,
    page_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 错误表：记录异常情况
  CREATE TABLE IF NOT EXISTS errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    session_id TEXT,
    error_type TEXT NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 索引
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
  CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
`);

module.exports = db;
