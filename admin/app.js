(function () {
  'use strict';

  var API_BASE = '/api/admin';
  var app = document.getElementById('app');
  var currentPage = 'overview';

  // ========== 路由 ==========
  document.querySelectorAll('.sidebar nav a').forEach(function (link) {
    link.addEventListener('click', function () {
      var page = this.getAttribute('data-page');
      if (page === currentPage) return;
      document.querySelectorAll('.sidebar nav a').forEach(function (a) { a.classList.remove('active'); });
      this.classList.add('active');
      currentPage = page;
      renderPage(page);
    });
  });

  // ========== API 请求 ==========
  function api(path) {
    return fetch(API_BASE + path)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.code !== 0) throw new Error(data.message || '请求失败');
        return data.data;
      });
  }

  // ========== 页面渲染 ==========
  function renderPage(page, params) {
    app.innerHTML = '<div class="loading">加载中...</div>';
    switch (page) {
      case 'overview': renderOverview(); break;
      case 'sessions': renderSessions(); break;
      case 'users': renderUsers(); break;
      case 'errors': renderErrors(); break;
      case 'session-detail': renderSessionDetail(params); break;
      default: renderOverview();
    }
  }

  // ========== 概览页 ==========
  function renderOverview() {
    Promise.all([api('/stats/overview'), api('/stats/trend?days=7'), api('/stats/events')])
      .then(function (results) {
        var stats = results[0];
        var trend = results[1];
        var events = results[2];

        var html = '<h1 class="page-title">📊 数据概览</h1>';

        // 统计卡片
        html += '<div class="stats-grid">';
        html += statCard('总用户数', stats.totalUsers, '今日 +' + stats.todayUsers);
        html += statCard('总会话数', stats.totalSessions, '今日 +' + stats.todaySessions);
        html += statCard('总消息数', stats.totalMessages, '今日 +' + stats.todayMessages);
        html += statCard('平均消息/会话', stats.avgMessagesPerSession, '');
        html += statCard('错误总数', stats.totalErrors, '', stats.totalErrors > 0 ? 'red' : '');
        html += '</div>';

        // 趋势表格
        html += '<div class="card">';
        html += '<div class="card-header">最近 7 天趋势</div>';
        html += '<table><thead><tr><th>日期</th><th>用户数</th><th>会话数</th><th>消息数</th></tr></thead><tbody>';
        trend.forEach(function (row) {
          html += '<tr><td>' + row.date + '</td><td>' + row.users + '</td><td>' + row.sessions + '</td><td>' + row.messages + '</td></tr>';
        });
        html += '</tbody></table></div>';

        // 事件统计
        if (events.length > 0) {
          html += '<div class="card">';
          html += '<div class="card-header">事件统计</div>';
          html += '<table><thead><tr><th>事件类型</th><th>次数</th></tr></thead><tbody>';
          events.forEach(function (e) {
            html += '<tr><td><span class="tag tag-blue">' + esc(e.event_type) + '</span></td><td>' + e.count + '</td></tr>';
          });
          html += '</tbody></table></div>';
        }

        app.innerHTML = html;
      })
      .catch(function (err) {
        app.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>加载失败: ' + esc(err.message) + '</p><p style="margin-top:8px;font-size:13px;color:#aaa;">请确认后端服务已启动 (npm start)</p></div>';
      });
  }

  function statCard(label, value, sub, color) {
    return '<div class="stat-card">' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value" style="' + (color === 'red' ? 'color:#ea4335' : '') + '">' + value + '</div>' +
      (sub ? '<div class="stat-sub">' + sub + '</div>' : '') +
      '</div>';
  }

  // ========== 会话列表 ==========
  function renderSessions(page) {
    page = page || 1;
    api('/sessions?page=' + page + '&pageSize=20')
      .then(function (data) {
        var html = '<h1 class="page-title">💬 会话记录</h1>';

        if (data.list.length === 0) {
          html += '<div class="empty-state"><div class="icon">💬</div><p>暂无会话记录</p></div>';
          app.innerHTML = html;
          return;
        }

        html += '<div class="card">';
        html += '<div class="card-header">共 ' + data.total + ' 条会话</div>';
        html += '<table><thead><tr><th>会话 ID</th><th>用户</th><th>消息数</th><th>来源页面</th><th>设备</th><th>开始时间</th><th>操作</th></tr></thead><tbody>';
        data.list.forEach(function (s) {
          var shortSession = s.session_id.length > 16 ? s.session_id.substr(0, 16) + '...' : s.session_id;
          var shortUser = s.user_id.length > 14 ? s.user_id.substr(0, 14) + '...' : s.user_id;
          var shortUrl = s.page_url ? (s.page_url.length > 30 ? s.page_url.substr(0, 30) + '...' : s.page_url) : '-';
          html += '<tr>' +
            '<td title="' + esc(s.session_id) + '">' + esc(shortSession) + '</td>' +
            '<td title="' + esc(s.user_id) + '">' + esc(shortUser) + '</td>' +
            '<td>' + (s.actual_msg_count || s.message_count) + '</td>' +
            '<td title="' + esc(s.page_url || '') + '">' + esc(shortUrl) + '</td>' +
            '<td><span class="tag tag-gray">' + esc(s.device_type || '-') + '</span></td>' +
            '<td>' + esc(s.started_at || '') + '</td>' +
            '<td><a href="#" class="view-session" data-sid="' + esc(s.session_id) + '" style="color:#4285f4;text-decoration:none;">查看聊天</a></td>' +
            '</tr>';
        });
        html += '</tbody></table>';
        html += renderPagination(data.total, data.page, data.pageSize, 'sessions');
        html += '</div>';

        app.innerHTML = html;

        // 绑定查看聊天事件
        app.querySelectorAll('.view-session').forEach(function (a) {
          a.addEventListener('click', function (e) {
            e.preventDefault();
            currentPage = 'session-detail';
            renderPage('session-detail', { sessionId: this.getAttribute('data-sid') });
          });
        });

        bindPagination('sessions', renderSessions);
      })
      .catch(function (err) {
        app.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>' + esc(err.message) + '</p></div>';
      });
  }

  // ========== 会话详情（聊天记录） ==========
  function renderSessionDetail(params) {
    var sessionId = params.sessionId;
    api('/sessions/' + encodeURIComponent(sessionId) + '/messages')
      .then(function (messages) {
        var html = '<button class="back-btn" id="back-to-sessions">← 返回会话列表</button>';
        html += '<h1 class="page-title">聊天记录</h1>';
        html += '<p style="color:#888;font-size:13px;margin-bottom:16px;">会话 ID: ' + esc(sessionId) + '</p>';

        html += '<div class="card"><div class="chat-panel">';
        if (messages.length === 0) {
          html += '<div class="empty-state"><div class="icon">💬</div><p>该会话暂无消息</p></div>';
        } else {
          messages.forEach(function (m) {
            var roleClass = m.role === 'user' ? 'user' : 'bot';
            var roleLabel = m.role === 'user' ? '用户' : 'AI';
            html += '<div class="chat-record ' + roleClass + '">' +
              '<div class="role-tag">' + roleLabel + '</div>' +
              '<div>' +
                '<div class="record-bubble">' + esc(m.content) + '</div>' +
                '<div class="record-time">' + esc(m.created_at || '') +
                  (m.response_time_ms ? ' · 响应 ' + m.response_time_ms + 'ms' : '') +
                '</div>' +
              '</div>' +
            '</div>';
          });
        }
        html += '</div></div>';

        app.innerHTML = html;

        document.getElementById('back-to-sessions').addEventListener('click', function () {
          currentPage = 'sessions';
          document.querySelectorAll('.sidebar nav a').forEach(function (a) {
            a.classList.toggle('active', a.getAttribute('data-page') === 'sessions');
          });
          renderSessions();
        });
      })
      .catch(function (err) {
        app.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>' + esc(err.message) + '</p></div>';
      });
  }

  // ========== 用户列表 ==========
  function renderUsers(page) {
    page = page || 1;
    api('/users?page=' + page + '&pageSize=20')
      .then(function (data) {
        var html = '<h1 class="page-title">👥 用户管理</h1>';

        if (data.list.length === 0) {
          html += '<div class="empty-state"><div class="icon">👥</div><p>暂无用户数据</p></div>';
          app.innerHTML = html;
          return;
        }

        html += '<div class="card">';
        html += '<div class="card-header">共 ' + data.total + ' 位用户</div>';
        html += '<table><thead><tr><th>用户 ID</th><th>会话数</th><th>消息数</th><th>设备</th><th>浏览器</th><th>系统</th><th>首次访问</th><th>最近访问</th></tr></thead><tbody>';
        data.list.forEach(function (u) {
          var shortId = u.user_id.length > 18 ? u.user_id.substr(0, 18) + '...' : u.user_id;
          html += '<tr>' +
            '<td title="' + esc(u.user_id) + '">' + esc(shortId) + '</td>' +
            '<td>' + u.session_count + '</td>' +
            '<td>' + u.message_count + '</td>' +
            '<td><span class="tag tag-gray">' + esc(u.device_type || '-') + '</span></td>' +
            '<td>' + esc(u.browser || '-') + '</td>' +
            '<td>' + esc(u.os || '-') + '</td>' +
            '<td>' + esc(u.first_seen_at || '') + '</td>' +
            '<td>' + esc(u.last_seen_at || '') + '</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
        html += renderPagination(data.total, data.page, data.pageSize, 'users');
        html += '</div>';

        app.innerHTML = html;
        bindPagination('users', renderUsers);
      })
      .catch(function (err) {
        app.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>' + esc(err.message) + '</p></div>';
      });
  }

  // ========== 错误日志 ==========
  function renderErrors(page) {
    page = page || 1;
    api('/errors?page=' + page + '&pageSize=20')
      .then(function (data) {
        var html = '<h1 class="page-title">⚠️ 错误日志</h1>';

        if (data.list.length === 0) {
          html += '<div class="empty-state"><div class="icon">✅</div><p>暂无错误记录，一切正常</p></div>';
          app.innerHTML = html;
          return;
        }

        html += '<div class="card">';
        html += '<div class="card-header">共 ' + data.total + ' 条错误</div>';
        html += '<table><thead><tr><th>时间</th><th>类型</th><th>错误信息</th><th>用户</th><th>会话</th></tr></thead><tbody>';
        data.list.forEach(function (e) {
          var shortUser = e.user_id ? (e.user_id.length > 14 ? e.user_id.substr(0, 14) + '...' : e.user_id) : '-';
          var shortSession = e.session_id ? (e.session_id.length > 14 ? e.session_id.substr(0, 14) + '...' : e.session_id) : '-';
          html += '<tr>' +
            '<td>' + esc(e.created_at || '') + '</td>' +
            '<td><span class="tag tag-red">' + esc(e.error_type) + '</span></td>' +
            '<td>' + esc(e.error_message || '') + '</td>' +
            '<td title="' + esc(e.user_id || '') + '">' + esc(shortUser) + '</td>' +
            '<td title="' + esc(e.session_id || '') + '">' + esc(shortSession) + '</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
        html += renderPagination(data.total, data.page, data.pageSize, 'errors');
        html += '</div>';

        app.innerHTML = html;
        bindPagination('errors', renderErrors);
      })
      .catch(function (err) {
        app.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>' + esc(err.message) + '</p></div>';
      });
  }

  // ========== 分页组件 ==========
  function renderPagination(total, page, pageSize, context) {
    var totalPages = Math.ceil(total / pageSize);
    if (totalPages <= 1) return '';
    var html = '<div class="pagination" data-context="' + context + '">';
    html += '<button class="page-btn" data-p="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>上一页</button>';
    for (var i = 1; i <= totalPages && i <= 10; i++) {
      html += '<button class="page-btn' + (i === page ? ' active' : '') + '" data-p="' + i + '">' + i + '</button>';
    }
    html += '<button class="page-btn" data-p="' + (page + 1) + '"' + (page >= totalPages ? ' disabled' : '') + '>下一页</button>';
    html += '</div>';
    return html;
  }

  function bindPagination(context, renderFn) {
    var container = app.querySelector('.pagination[data-context="' + context + '"]');
    if (!container) return;
    container.querySelectorAll('.page-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (this.disabled) return;
        renderFn(parseInt(this.getAttribute('data-p')));
      });
    });
  }

  // ========== 工具函数 ==========
  function esc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ========== 初始化 ==========
  renderPage('overview');

})();
