import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 测试 POST /api/chat/message 参数校验与业务逻辑
 * Validates: Requirements 5.9, 2.4
 */

// Mock db for validation-only tests
vi.mock('../db', () => ({
  pool: {
    getConnection: vi.fn(),
  },
}));

const routeModule = await import('../routes/chat');
const router = routeModule.default || routeModule;

// Extract the POST /message handler
const layer = router.stack.find(
  (l) => l.route && l.route.path === '/message' && l.route.methods.post
);
const handler = layer.route.stack[0].handle;

function createRes() {
  let _statusCode = 200;
  let _body;
  return {
    status(code) { _statusCode = code; return this; },
    json(data) { _body = data; },
    get statusCode() { return _statusCode; },
    get body() { return _body; },
  };
}

describe('POST /api/chat/message — 参数校验', () => {
  it('缺少 sessionId 时返回 400', async () => {
    const req = { body: { userId: 'u1', content: 'hello' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: -1, message: '参数缺失' });
  });

  it('缺少 userId 时返回 400', async () => {
    const req = { body: { sessionId: 's1', content: 'hello' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: -1, message: '参数缺失' });
  });

  it('缺少 content 时返回 400', async () => {
    const req = { body: { sessionId: 's1', userId: 'u1' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: -1, message: '参数缺失' });
  });

  it('所有参数为空字符串时返回 400', async () => {
    const req = { body: { sessionId: '', userId: '', content: '' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: -1, message: '参数缺失' });
  });

  it('body 为空对象时返回 400', async () => {
    const req = { body: {} };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: -1, message: '参数缺失' });
  });
});

describe('POST /api/chat/message — 业务逻辑 (real DB)', () => {
  const { pool: realPool } = require('../db');
  let conn;
  const testSessionId = 'test-chat-msg-' + Date.now();
  const testUserId = 'test-user-chat-1';

  beforeEach(async () => {
    conn = await realPool.getConnection();
    // Ensure a test session exists
    await conn.query(
      `INSERT IGNORE INTO sessions (session_id, user_id, status, message_count) VALUES (?, ?, 'human', 0)`,
      [testSessionId, testUserId]
    );
  });

  afterEach(async () => {
    await conn.query(`DELETE FROM messages WHERE session_id = ?`, [testSessionId]);
    await conn.query(`DELETE FROM sessions WHERE session_id = ?`, [testSessionId]);
    conn.release();
  });

  it('参数合法时插入消息并返回 id 和 created_at', async () => {
    const req = { body: { sessionId: testSessionId, userId: testUserId, content: 'hello world' } };
    const res = createRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('created_at');
    expect(typeof res.body.data.id).toBe('number');

    // Verify the message was inserted with role='user'
    const [rows] = await conn.query(
      `SELECT role, content FROM messages WHERE id = ?`,
      [res.body.data.id]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].role).toBe('user');
    expect(rows[0].content).toBe('hello world');

    // Verify message_count was incremented
    const [sessions] = await conn.query(
      `SELECT message_count FROM sessions WHERE session_id = ?`,
      [testSessionId]
    );
    expect(sessions[0].message_count).toBe(1);
  });

  it('多次发送消息 message_count 递增', async () => {
    for (let i = 0; i < 3; i++) {
      const req = { body: { sessionId: testSessionId, userId: testUserId, content: `msg-${i}` } };
      const res = createRes();
      await handler(req, res);
      expect(res.body.code).toBe(0);
    }

    const [sessions] = await conn.query(
      `SELECT message_count FROM sessions WHERE session_id = ?`,
      [testSessionId]
    );
    expect(sessions[0].message_count).toBe(3);
  });
});
