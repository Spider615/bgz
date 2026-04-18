import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 测试 POST /api/track/handoff 参数校验与业务逻辑
 * Validates: Requirements 5.3, 5.4, 1.3
 *
 * Validation tests use direct handler invocation with mock req/res.
 * DB-dependent tests use the real MySQL database (pool from db.js).
 */

// Mock db for validation-only tests (no DB calls)
vi.mock('../db', () => ({
  pool: {
    getConnection: vi.fn(),
  },
}));

const routeModule = await import('../routes/track');
const router = routeModule.default || routeModule;

// Extract the POST /handoff handler
const layer = router.stack.find(
  (l) => l.route && l.route.path === '/handoff' && l.route.methods.post
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

describe('POST /api/track/handoff — 参数校验', () => {
  it('缺少 sessionId 时返回 400', async () => {
    const req = { body: { userId: 'user-1' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: -1, message: '参数缺失: sessionId 和 userId 为必填项' });
  });

  it('缺少 userId 时返回 400', async () => {
    const req = { body: { sessionId: 'sess-1' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: -1, message: '参数缺失: sessionId 和 userId 为必填项' });
  });

  it('sessionId 和 userId 都缺失时返回 400', async () => {
    const req = { body: {} };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: -1, message: '参数缺失: sessionId 和 userId 为必填项' });
  });

  it('空字符串 sessionId 时返回 400', async () => {
    const req = { body: { sessionId: '', userId: 'user-1' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: -1, message: '参数缺失: sessionId 和 userId 为必填项' });
  });

  it('空字符串 userId 时返回 400', async () => {
    const req = { body: { sessionId: 'sess-1', userId: '' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: -1, message: '参数缺失: sessionId 和 userId 为必填项' });
  });
});

describe('POST /api/track/handoff — 业务逻辑 (real DB)', () => {
  // Use the real pool for DB-dependent tests
  const { pool: realPool } = require('../db');
  let conn;

  beforeEach(async () => {
    conn = await realPool.getConnection();
  });

  afterEach(async () => {
    // Clean up test data
    await conn.query(`DELETE FROM events WHERE session_id LIKE 'test-handoff-%'`);
    await conn.query(`DELETE FROM sessions WHERE session_id LIKE 'test-handoff-%'`);
    conn.release();
  });

  it('sessionId 不存在时返回 404', async () => {
    // Temporarily restore real pool.getConnection for the handler
    const origGetConnection = realPool.getConnection.bind(realPool);
    const { pool: mockPool } = await import('../db');

    // The handler uses CJS require('../db').pool which is the real pool
    // So we just call the handler directly — it will use the real DB
    const req = { body: { sessionId: 'test-handoff-nonexistent', userId: 'user-1' } };
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ code: -1, message: '会话不存在' });
  });

  it('成功转人工返回 { code: 0, message: "ok" }', async () => {
    const sessionId = 'test-handoff-' + Date.now();
    const userId = 'test-user-1';

    // Insert a test session
    await conn.query(
      `INSERT INTO sessions (session_id, user_id, status) VALUES (?, ?, 'ai')`,
      [sessionId, userId]
    );

    const req = { body: { sessionId, userId } };
    const res = createRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ code: 0, message: 'ok' });

    // Verify session status was updated
    const [rows] = await conn.query(
      `SELECT status, handoff_at FROM sessions WHERE session_id = ?`,
      [sessionId]
    );
    expect(rows[0].status).toBe('human');
    expect(rows[0].handoff_at).not.toBeNull();

    // Verify event was recorded
    const [events] = await conn.query(
      `SELECT event_type, user_id FROM events WHERE session_id = ? AND event_type = 'handoff_to_human'`,
      [sessionId]
    );
    expect(events.length).toBe(1);
    expect(events[0].user_id).toBe(userId);

    // Clean up
    await conn.query(`DELETE FROM events WHERE session_id = ?`, [sessionId]);
    await conn.query(`DELETE FROM sessions WHERE session_id = ?`, [sessionId]);
  });
});
