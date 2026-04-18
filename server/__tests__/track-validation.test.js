import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 测试 Track API 参数校验逻辑
 * 验证需求: 6.4
 */

// Mock express and db before importing the router
vi.mock('../db', () => ({
  pool: {
    getConnection: vi.fn(),
  },
}));

const { default: express } = await import('express');
const { default: trackRouter } = await import('../routes/track');

// Build a minimal Express app for testing
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/track', trackRouter);
  return app;
}

// Lightweight supertest-like helper using the app's handle method
async function request(app, method, path, body) {
  return new Promise((resolve) => {
    const req = {
      method: method.toUpperCase(),
      url: path,
      headers: { 'content-type': 'application/json' },
      body,
    };

    const chunks = [];
    const res = {
      statusCode: 200,
      _headers: {},
      setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
      getHeader(k) { return this._headers[k.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json(data) {
        this.statusCode = this.statusCode || 200;
        resolve({ status: this.statusCode, body: data });
      },
      send(data) {
        resolve({ status: this.statusCode, body: data });
      },
      end() {
        resolve({ status: this.statusCode, body: null });
      },
    };

    // Use Express's built-in request handling
    app.handle(
      Object.assign(require('stream').Readable.from(''), req),
      Object.assign(require('stream').Writable({ write(_, __, cb) { cb(); } }), res),
      () => resolve({ status: 404, body: null })
    );
  });
}

describe('Track API 参数校验', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  it('缺少 userId 时返回 400 和描述性错误信息', async () => {
    // Simulate the route handler directly
    const mockReq = {
      body: {
        events: [{ type: 'session_start' }],
      },
    };
    let statusCode;
    let responseBody;
    const mockRes = {
      status(code) { statusCode = code; return this; },
      json(data) { responseBody = data; },
    };

    // Import and call the route handler directly
    const routeModule = await import('../routes/track');
    const router = routeModule.default || routeModule;

    // Extract the POST /collect handler from the router
    const layer = router.stack.find(
      (l) => l.route && l.route.path === '/collect' && l.route.methods.post
    );
    const handler = layer.route.stack[0].handle;

    await handler(mockReq, mockRes);

    expect(statusCode).toBe(400);
    expect(responseBody).toEqual({
      code: -1,
      message: '参数缺失: userId 为必填项',
    });
  });

  it('events 不是数组时返回 400 和描述性错误信息', async () => {
    const mockReq = {
      body: {
        userId: 'user-123',
        events: 'not-an-array',
      },
    };
    let statusCode;
    let responseBody;
    const mockRes = {
      status(code) { statusCode = code; return this; },
      json(data) { responseBody = data; },
    };

    const routeModule = await import('../routes/track');
    const router = routeModule.default || routeModule;
    const layer = router.stack.find(
      (l) => l.route && l.route.path === '/collect' && l.route.methods.post
    );
    const handler = layer.route.stack[0].handle;

    await handler(mockReq, mockRes);

    expect(statusCode).toBe(400);
    expect(responseBody).toEqual({
      code: -1,
      message: '参数缺失: events 必须为非空数组',
    });
  });

  it('events 为空数组时返回 400 和描述性错误信息', async () => {
    const mockReq = {
      body: {
        userId: 'user-123',
        events: [],
      },
    };
    let statusCode;
    let responseBody;
    const mockRes = {
      status(code) { statusCode = code; return this; },
      json(data) { responseBody = data; },
    };

    const routeModule = await import('../routes/track');
    const router = routeModule.default || routeModule;
    const layer = router.stack.find(
      (l) => l.route && l.route.path === '/collect' && l.route.methods.post
    );
    const handler = layer.route.stack[0].handle;

    await handler(mockReq, mockRes);

    expect(statusCode).toBe(400);
    expect(responseBody).toEqual({
      code: -1,
      message: '参数缺失: events 必须为非空数组',
    });
  });

  it('events 为 undefined 时返回 400 和描述性错误信息', async () => {
    const mockReq = {
      body: {
        userId: 'user-123',
      },
    };
    let statusCode;
    let responseBody;
    const mockRes = {
      status(code) { statusCode = code; return this; },
      json(data) { responseBody = data; },
    };

    const routeModule = await import('../routes/track');
    const router = routeModule.default || routeModule;
    const layer = router.stack.find(
      (l) => l.route && l.route.path === '/collect' && l.route.methods.post
    );
    const handler = layer.route.stack[0].handle;

    await handler(mockReq, mockRes);

    expect(statusCode).toBe(400);
    expect(responseBody).toEqual({
      code: -1,
      message: '参数缺失: events 必须为非空数组',
    });
  });

  it('userId 和 events 都缺失时优先报 userId 错误', async () => {
    const mockReq = {
      body: {},
    };
    let statusCode;
    let responseBody;
    const mockRes = {
      status(code) { statusCode = code; return this; },
      json(data) { responseBody = data; },
    };

    const routeModule = await import('../routes/track');
    const router = routeModule.default || routeModule;
    const layer = router.stack.find(
      (l) => l.route && l.route.path === '/collect' && l.route.methods.post
    );
    const handler = layer.route.stack[0].handle;

    await handler(mockReq, mockRes);

    expect(statusCode).toBe(400);
    expect(responseBody).toEqual({
      code: -1,
      message: '参数缺失: userId 为必填项',
    });
  });
});
