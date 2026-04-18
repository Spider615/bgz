const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '123456',
  database: 'chat_admin',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 初始化建表
async function initDB() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(255) UNIQUE NOT NULL,
        first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        device_type VARCHAR(50),
        browser VARCHAR(100),
        os VARCHAR(100)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        bot_id VARCHAR(255),
        page_url TEXT,
        referrer TEXT,
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME,
        message_count INT DEFAULT 0,
        device_type VARCHAR(50),
        browser VARCHAR(100),
        os VARCHAR(100),
        status VARCHAR(10) NOT NULL DEFAULT 'ai',
        handoff_at DATETIME DEFAULT NULL,
        INDEX idx_sessions_user_id (user_id),
        INDEX idx_sessions_status (status),
        INDEX idx_sessions_handoff_at (handoff_at)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        role ENUM('user', 'bot', 'agent', 'system') NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        response_time_ms INT,
        INDEX idx_messages_session_id (session_id),
        INDEX idx_messages_created_at (created_at)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        session_id VARCHAR(255),
        event_type VARCHAR(100) NOT NULL,
        event_data TEXT,
        page_url TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_events_event_type (event_type),
        INDEX idx_events_created_at (created_at)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS errors (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(255),
        session_id VARCHAR(255),
        error_type VARCHAR(100) NOT NULL,
        error_message TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 新增索引：优化活跃用户统计和响应时长聚合查询
    // MySQL 5.x 不支持 CREATE INDEX IF NOT EXISTS，用查询判断
    const [existingIndexes] = await conn.query(`SHOW INDEX FROM messages`);
    const indexNames = existingIndexes.map(r => r.Key_name);
    if (!indexNames.includes('idx_messages_user_id')) {
      await conn.query(`CREATE INDEX idx_messages_user_id ON messages(user_id)`);
    }
    if (!indexNames.includes('idx_messages_response_time')) {
      await conn.query(`CREATE INDEX idx_messages_response_time ON messages(response_time_ms)`);
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        agent_id VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL DEFAULT 'AI 助手',
        subtitle VARCHAR(255) DEFAULT '随时为您解答',
        welcome_message TEXT,
        preset_questions JSON,
        primary_color VARCHAR(32) DEFAULT '#667eea',
        bot_id VARCHAR(255),
        access_key_id VARCHAR(255),
        access_key_secret VARCHAR(512),
        api_base VARCHAR(512) DEFAULT 'https://insight.juzibot.com',
        is_default TINYINT(1) NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_agents_is_default (is_default),
        INDEX idx_agents_is_active (is_active)
      )
    `);

    // 增量迁移：兼容已有数据库
    await migrateDB(conn);

    console.log('[DB] MySQL 表初始化完成');
  } finally {
    conn.release();
  }
}

// 增量迁移：对已有数据库执行 schema 变更
async function migrateDB(conn) {
  // 检查 sessions 表是否存在 status 字段
  const [sessionCols] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'status'`
  );
  if (sessionCols.length === 0) {
    await conn.query(`ALTER TABLE sessions ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'ai'`);
    await conn.query(`ALTER TABLE sessions ADD COLUMN handoff_at DATETIME DEFAULT NULL`);
    await conn.query(`CREATE INDEX idx_sessions_status ON sessions(status)`);
    await conn.query(`CREATE INDEX idx_sessions_handoff_at ON sessions(handoff_at)`);
    console.log('[DB] 迁移：sessions 表新增 status、handoff_at 字段及索引');
  }

  // 检查 messages 表 role 字段是否包含 agent
  const [roleCols] = await conn.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'role'`
  );
  if (roleCols.length > 0 && !roleCols[0].COLUMN_TYPE.includes('agent')) {
    await conn.query(`ALTER TABLE messages MODIFY COLUMN role ENUM('user','bot','agent','system') NOT NULL`);
    console.log('[DB] 迁移：messages 表 role 字段已扩展');
  }
}

module.exports = { pool, initDB };
