(function () {
  'use strict';

  var API_BASE = '/api/admin';
  var app = document.getElementById('app');
  var validPages = ['overview', 'sessions', 'users', 'errors', 'human-service', 'agents'];
  var initialPage = validPages.indexOf(location.hash.replace('#', '')) !== -1 ? location.hash.replace('#', '') : 'overview';
  var currentPage = initialPage;

  // ========== 路由 ==========
  function navigateTo(page, params) {
    if (validPages.indexOf(page) !== -1) {
      location.hash = page;
    }
    document.querySelectorAll('.sidebar nav a').forEach(function (a) { a.classList.remove('active'); });
    var activeLink = document.querySelector('.sidebar nav a[data-page="' + page + '"]');
    if (activeLink) activeLink.classList.add('active');
    currentPage = page;
    renderPage(page, params);
  }

  document.querySelectorAll('.sidebar nav a').forEach(function (link) {
    link.addEventListener('click', function () {
      var page = this.getAttribute('data-page');
      if (page === currentPage) return;
      navigateTo(page);
    });
  });

  // 浏览器前进/后退
  window.addEventListener('hashchange', function () {
    var page = location.hash.replace('#', '');
    if (validPages.indexOf(page) !== -1 && page !== currentPage) {
      navigateTo(page);
    }
  });

  // 初始化侧边栏高亮
  document.querySelectorAll('.sidebar nav a').forEach(function (a) { a.classList.remove('active'); });
  var initLink = document.querySelector('.sidebar nav a[data-page="' + initialPage + '"]');
  if (initLink) initLink.classList.add('active');

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
  var hsPollingTimer = null;

  function stopHsPolling() {
    if (hsPollingTimer) {
      clearInterval(hsPollingTimer);
      hsPollingTimer = null;
    }
  }

  function renderPage(page, params) {
    stopHsPolling();
    app.innerHTML = '<div class="loading">加载中...</div>';
    switch (page) {
      case 'overview': renderOverview(); break;
      case 'sessions': renderSessions(); break;
      case 'users': renderUsers(); break;
      case 'errors': renderErrors(); break;
      case 'human-service': renderHumanService(); break;
      case 'agents': renderAgents(); break;
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
        html += statCard('平均响应时长', (stats.avgResponseTimeMs / 1000).toFixed(2) + ' s', '今日 ' + (stats.todayAvgResponseTimeMs / 1000).toFixed(2) + ' s', stats.avgResponseTimeMs > 5000 ? 'red' : '');
        html += statCard('7 日活跃用户', stats.activeUsers7d, '');
        html += statCard('30 日活跃用户', stats.activeUsers30d, '');
        html += statCard('转人工会话', stats.totalHumanSessions, '今日 +' + stats.todayHumanSessions);
        html += statCard('转人工率', stats.humanHandoffRate + '%', '');
        html += '</div>';

        // 趋势图表
        html += '<div class="card">';
        html += '<div class="card-header">最近 7 天趋势</div>';
        html += '<div style="padding:20px;"><canvas id="trendChart" height="100"></canvas></div>';
        html += '</div>';

        // 行为分布
        var eventLabelMap = {
          'chat_open': '打开聊天窗口',
          'chat_close': '关闭聊天窗口',
          'session_start': '会话开始',
          'session_end': '会话结束',
          'session_reset': '重置会话',
          'quick_action_click': '快捷操作点击',
          'handoff_to_human': '转人工客服',
          'agent_switch': '切换智能体'
        };
        if (events.length > 0) {
          html += '<div class="card">';
          html += '<div class="card-header">行为分布</div>';
          html += '<table><thead><tr><th>行为类型</th><th>次数</th></tr></thead><tbody>';
          events.forEach(function (e) {
            var label = eventLabelMap[e.event_type] || e.event_type;
            html += '<tr><td><span class="tag tag-blue">' + esc(label) + '</span></td><td>' + e.count + '</td></tr>';
          });
          html += '</tbody></table></div>';
        }

        app.innerHTML = html;

        // 渲染趋势图表
        var ctx = document.getElementById('trendChart');
        if (ctx && typeof Chart !== 'undefined') {
          var labels = trend.map(function (r) { return fmtDate(r.date).split(' ')[0]; });
          var usersData = trend.map(function (r) { return r.users; });
          var sessionsData = trend.map(function (r) { return r.sessions; });
          var messagesData = trend.map(function (r) { return r.messages; });
          var humanData = trend.map(function (r) { return r.humanSessions || 0; });
          var respTimeData = trend.map(function (r) { return (r.avgResponseTime / 1000).toFixed(2); });

          new Chart(ctx, {
            type: 'bar',
            data: {
              labels: labels,
              datasets: [
                {
                  type: 'line',
                  label: '用户数',
                  data: usersData,
                  borderColor: '#4285f4',
                  backgroundColor: 'rgba(66,133,244,0.08)',
                  borderWidth: 2,
                  pointRadius: 4,
                  pointBackgroundColor: '#4285f4',
                  tension: 0.3,
                  fill: false,
                  yAxisID: 'y'
                },
                {
                  type: 'line',
                  label: '会话数',
                  data: sessionsData,
                  borderColor: '#34a853',
                  backgroundColor: 'rgba(52,168,83,0.08)',
                  borderWidth: 2,
                  pointRadius: 4,
                  pointBackgroundColor: '#34a853',
                  tension: 0.3,
                  fill: false,
                  yAxisID: 'y'
                },
                {
                  type: 'line',
                  label: '消息数',
                  data: messagesData,
                  borderColor: '#fbbc04',
                  backgroundColor: 'rgba(251,188,4,0.08)',
                  borderWidth: 2,
                  pointRadius: 4,
                  pointBackgroundColor: '#fbbc04',
                  tension: 0.3,
                  fill: false,
                  yAxisID: 'y'
                },
                {
                  type: 'line',
                  label: '转人工数',
                  data: humanData,
                  borderColor: '#ea4335',
                  backgroundColor: 'rgba(234,67,53,0.08)',
                  borderWidth: 2,
                  pointRadius: 4,
                  pointBackgroundColor: '#ea4335',
                  tension: 0.3,
                  fill: false,
                  yAxisID: 'y'
                },
                {
                  type: 'bar',
                  label: '平均响应时长 (s)',
                  data: respTimeData,
                  backgroundColor: 'rgba(137,180,250,0.35)',
                  borderColor: '#89b4fa',
                  borderWidth: 1,
                  borderRadius: 4,
                  yAxisID: 'y1',
                  barPercentage: 0.4
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: true,
              interaction: {
                mode: 'index',
                intersect: false
              },
              plugins: {
                legend: {
                  position: 'top',
                  labels: { usePointStyle: true, padding: 16, font: { size: 12 } }
                },
                tooltip: {
                  callbacks: {
                    label: function (ctx) {
                      var label = ctx.dataset.label || '';
                      var val = ctx.parsed.y;
                      if (label.indexOf('响应') !== -1) return label + ': ' + val + ' s';
                      return label + ': ' + val;
                    }
                  }
                }
              },
              scales: {
                x: {
                  grid: { display: false }
                },
                y: {
                  type: 'linear',
                  position: 'left',
                  beginAtZero: true,
                  title: { display: true, text: '数量', font: { size: 12 } },
                  grid: { color: 'rgba(0,0,0,0.04)' },
                  ticks: { precision: 0 }
                },
                y1: {
                  type: 'linear',
                  position: 'right',
                  beginAtZero: true,
                  title: { display: true, text: '响应时长 (s)', font: { size: 12 } },
                  grid: { drawOnChartArea: false },
                  ticks: { precision: 0 }
                }
              }
            }
          });
        }
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
        var html = '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">';
        html += '<h1 class="page-title" style="margin-bottom:0;">💬 会话记录</h1>';
        html += '<button class="back-btn" id="refresh-sessions" style="margin-bottom:0;">🔄 刷新列表</button>';
        html += '</div>';

        if (data.list.length === 0) {
          html += '<div class="empty-state"><div class="icon">💬</div><p>暂无会话记录</p></div>';
          app.innerHTML = html;
          return;
        }

        html += '<div class="card">';
        html += '<div class="card-header">共 ' + data.total + ' 条会话</div>';
        html += '<table><thead><tr><th>会话 ID</th><th>用户</th><th>消息数</th><th>满意度</th><th>状态</th><th>平均响应时长</th><th>来源页面</th><th>设备</th><th>开始时间</th><th>结束时间</th><th>操作</th></tr></thead><tbody>';
        data.list.forEach(function (s) {
          var shortSession = s.session_id.length > 16 ? s.session_id.substr(0, 16) + '...' : s.session_id;
          var shortUser = s.user_id.length > 14 ? s.user_id.substr(0, 14) + '...' : s.user_id;
          var shortUrl = s.page_url ? (s.page_url.length > 30 ? s.page_url.substr(0, 30) + '...' : s.page_url) : '-';
          var feedbackCell;
          if (s.feedback_rating) {
            var r = Number(s.feedback_rating);
            var filled = '★'.repeat(r);
            var empty = '★'.repeat(5 - r);
            var commentTitle = s.feedback_comment ? ('评价：' + s.feedback_comment) : '该用户未填写文字评价';
            feedbackCell = '<span title="' + esc(commentTitle) + '" style="color:#fbbc04;white-space:nowrap;">' +
              filled + '<span style="color:#ddd;">' + empty + '</span>' +
              ' <span style="color:#666;font-size:12px;">' + r + '/5</span></span>';
          } else {
            feedbackCell = '<span style="color:#ccc;">-</span>';
          }
          html += '<tr>' +
            '<td title="' + esc(s.session_id) + '">' + esc(shortSession) + '</td>' +
            '<td title="' + esc(s.user_id) + '">' + esc(shortUser) + '</td>' +
            '<td>' + (s.actual_msg_count || s.message_count) + '</td>' +
            '<td>' + feedbackCell + '</td>' +
            '<td>' + (s.status === 'human' ? '<span class="tag tag-red">人工</span>' : '<span class="tag tag-blue">AI</span>') + '</td>' +
            '<td>' + (s.avg_response_time_ms > 0 ? (s.avg_response_time_ms / 1000).toFixed(2) + ' s' : '-') + '</td>' +
            '<td title="' + esc(s.page_url || '') + '">' + esc(shortUrl) + '</td>' +
            '<td><span class="tag tag-gray">' + esc(s.device_type || '-') + '</span></td>' +
            '<td>' + fmtDate(s.started_at) + '</td>' +
            '<td>' + (s.ended_at ? fmtDate(s.ended_at) : '-') + '</td>' +
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

        // 刷新按钮
        var refreshBtn = document.getElementById('refresh-sessions');
        if (refreshBtn) {
          refreshBtn.addEventListener('click', function () {
            renderSessions(page);
          });
        }
      })
      .catch(function (err) {
        app.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>' + esc(err.message) + '</p></div>';
      });
  }

  // ========== 会话详情（聊天记录） ==========
  function renderSessionDetail(params) {
    var sessionId = params.sessionId;
    Promise.all([
      api('/sessions/' + encodeURIComponent(sessionId) + '/messages'),
      api('/sessions/' + encodeURIComponent(sessionId) + '/feedback')
    ])
      .then(function (results) {
        var messages = results[0];
        var fb = results[1];
        var html = '<button class="back-btn" id="back-to-sessions">← 返回会话列表</button>';
        html += '<h1 class="page-title">聊天记录</h1>';
        html += '<p style="color:#888;font-size:13px;margin-bottom:16px;">会话 ID: ' + esc(sessionId) + '</p>';

        html += '<div class="card feedback-card-admin" style="margin-bottom:16px;">';
        html += '<div class="card-header">用户评价</div>';
        if (fb) {
          var r = Number(fb.rating);
          var filled = '★'.repeat(r);
          var empty = '★'.repeat(5 - r);
          html += '<div class="feedback-admin-body">' +
            '<div class="feedback-admin-stars">' +
              '<span style="color:#fbbc04;">' + filled + '</span>' +
              '<span style="color:#ddd;">' + empty + '</span>' +
              ' <span style="color:#666;margin-left:8px;font-size:14px;">' + r + '/5</span>' +
            '</div>' +
            '<div class="feedback-admin-comment">' +
              (fb.comment ? esc(fb.comment) : '<span style="color:#aaa;">用户未填写文字评价</span>') +
            '</div>' +
            '<div class="feedback-admin-time">提交于 ' + fmtDate(fb.created_at) + '</div>' +
          '</div>';
        } else {
          html += '<div class="empty-state" style="padding:20px;"><p>该会话暂无用户评价</p></div>';
        }
        html += '</div>';

        html += '<div class="card"><div class="chat-panel">';
        if (messages.length === 0) {
          html += '<div class="empty-state"><div class="icon">💬</div><p>该会话暂无消息</p></div>';
        } else {
          messages.forEach(function (m) {
            var roleClass = m.role === 'user' ? 'user' : (m.role === 'agent' ? 'agent' : (m.role === 'system' ? 'system' : 'bot'));
            var roleLabel = m.role === 'user' ? '用户' : (m.role === 'agent' ? '客服' : (m.role === 'system' ? '系统' : 'AI'));
            var contentHtml = (m.role === 'bot' || m.role === 'assistant') ? renderMarkdown(m.content) : esc(m.content);
            if (m.role === 'system') {
              html += '<div class="chat-record system">' +
                '<div>' +
                  '<div class="record-bubble">' + esc(m.content) + '</div>' +
                  '<div class="record-time" style="text-align:center;">' + fmtDate(m.created_at) + '</div>' +
                '</div>' +
              '</div>';
            } else {
              html += '<div class="chat-record ' + roleClass + '">' +
                '<div class="role-tag">' + roleLabel + '</div>' +
                '<div>' +
                  '<div class="record-bubble md-content">' + contentHtml + '</div>' +
                  '<div class="record-time">' + fmtDate(m.created_at) +
                    (m.response_time_ms ? ' · 响应 ' + (m.response_time_ms / 1000).toFixed(2) + 's' : '') +
                  '</div>' +
                '</div>' +
              '</div>';
            }
          });
        }
        html += '</div></div>';

        app.innerHTML = html;

        document.getElementById('back-to-sessions').addEventListener('click', function () {
          navigateTo('sessions');
        });
      })
      .catch(function (err) {
        app.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>' + esc(err.message) + '</p></div>';
      });
  }

  // ========== 人工客服页面 ==========
  function renderHumanService() {
    api('/sessions/human')
      .then(function (sessions) {
        var html = '<h1 class="page-title">🎧 人工客服</h1>';
        html += '<div class="hs-layout">';

        // 左侧：会话列表
        html += '<div class="hs-left">';
        html += '<div class="hs-list-header">转人工会话 (' + sessions.length + ')</div>';
        html += '<div class="hs-list" id="hs-session-list">';
        if (sessions.length === 0) {
          html += '<div class="empty-state"><div class="icon">🎧</div><p>暂无转人工会话</p></div>';
        } else {
          sessions.forEach(function (s) {
            var shortUser = s.user_id.length > 16 ? s.user_id.substr(0, 16) + '...' : s.user_id;
            var preview = s.last_message ? (s.last_message.length > 30 ? s.last_message.substr(0, 30) + '...' : s.last_message) : '暂无消息';
            html += '<div class="hs-session-item" data-sid="' + esc(s.session_id) + '">';
            html += '<div class="hs-item-main">';
            html += '<div class="hs-item-user">' + esc(shortUser) + '</div>';
            html += '<div class="hs-item-preview">' + esc(preview) + '</div>';
            html += '<div class="hs-item-meta">消息 ' + (s.message_count || 0) + ' · ' + fmtDate(s.handoff_at) + '</div>';
            html += '</div>';
            if (s.unread_count > 0) {
              html += '<span class="hs-unread-badge">' + s.unread_count + '</span>';
            }
            html += '</div>';
          });
        }
        html += '</div></div>';

        // 右侧：聊天面板（初始空状态）
        html += '<div class="hs-right" id="hs-chat-panel">';
        html += '<div class="empty-state" style="margin-top:120px;"><div class="icon">💬</div><p>选择左侧会话开始回复</p></div>';
        html += '</div>';

        html += '</div>';
        app.innerHTML = html;

        // 绑定会话项点击事件
        app.querySelectorAll('.hs-session-item').forEach(function (item) {
          item.addEventListener('click', function () {
            app.querySelectorAll('.hs-session-item').forEach(function (el) { el.classList.remove('active'); });
            this.classList.add('active');
            var sid = this.getAttribute('data-sid');
            renderHumanServiceChat(sid);
          });
        });
      })
      .catch(function (err) {
        app.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>加载失败: ' + esc(err.message) + '</p></div>';
      });
  }

  function renderHumanServiceChat(sessionId) {
    stopHsPolling();
    var panel = document.getElementById('hs-chat-panel');
    if (!panel) return;
    panel.innerHTML = '<div class="loading">加载中...</div>';

    api('/sessions/' + encodeURIComponent(sessionId) + '/messages')
      .then(function (messages) {
        var html = '<div class="hs-chat-header">会话: ' + esc(sessionId.length > 24 ? sessionId.substr(0, 24) + '...' : sessionId) + '</div>';
        html += '<div class="hs-chat-messages" id="hs-messages">';

        if (messages.length === 0) {
          html += '<div class="empty-state"><div class="icon">💬</div><p>该会话暂无消息</p></div>';
        } else {
          messages.forEach(function (m) {
            html += renderHsChatMessage(m);
          });
        }
        html += '</div>';

        // 输入框
        html += '<div class="hs-chat-input">';
        html += '<textarea id="hs-reply-input" placeholder="输入回复内容..." rows="1"></textarea>';
        html += '<button id="hs-send-btn">发送</button>';
        html += '</div>';

        panel.innerHTML = html;

        // 滚动到底部
        var msgContainer = document.getElementById('hs-messages');
        if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;

        // 记录最后消息 ID 用于 Polling
        var hsLastMsgId = 0;
        if (messages.length > 0) {
          hsLastMsgId = messages[messages.length - 1].id;
        }

        // 发送按钮事件
        var sendBtn = document.getElementById('hs-send-btn');
        var replyInput = document.getElementById('hs-reply-input');
        if (sendBtn && replyInput) {
          function sendSingleReply(text) {
            return fetch(API_BASE + '/sessions/' + encodeURIComponent(sessionId) + '/reply', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: text })
            })
              .then(function (res) { return res.json(); })
              .then(function (data) {
                if (data.code !== 0) throw new Error(data.message || '发送失败');
                var newMsg = { id: data.data.id, role: 'agent', content: text, created_at: data.data.created_at };
                var container = document.getElementById('hs-messages');
                if (container) {
                  container.insertAdjacentHTML('beforeend', renderHsChatMessage(newMsg));
                  container.scrollTop = container.scrollHeight;
                }
                if (data.data.id > hsLastMsgId) hsLastMsgId = data.data.id;
              });
          }

          sendBtn.addEventListener('click', function () {
            var raw = replyInput.value.trim();
            if (!raw) return;
            // 按换行拆分为多条消息
            var lines = raw.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; });
            if (lines.length === 0) return;
            sendBtn.disabled = true;
            replyInput.value = '';

            // 顺序发送每一行
            var chain = Promise.resolve();
            lines.forEach(function (line) {
              chain = chain.then(function () { return sendSingleReply(line); });
            });
            chain
              .then(function () { sendBtn.disabled = false; })
              .catch(function (err) {
                sendBtn.disabled = false;
                alert('发送失败: ' + err.message);
              });
          });

          // Enter 键发送
          replyInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendBtn.click();
            }
          });
        }

        // 启动 3 秒 Polling
        hsPollingTimer = setInterval(function () {
          fetch(API_BASE + '/sessions/' + encodeURIComponent(sessionId) + '/new-messages?afterId=' + hsLastMsgId)
            .then(function (res) { return res.json(); })
            .then(function (data) {
              if (data.code !== 0 || !data.data || data.data.length === 0) return;
              var container = document.getElementById('hs-messages');
              if (!container) return;
              data.data.forEach(function (m) {
                if (m.id > hsLastMsgId) {
                  container.insertAdjacentHTML('beforeend', renderHsChatMessage(m));
                  hsLastMsgId = m.id;
                }
              });
              container.scrollTop = container.scrollHeight;
            })
            .catch(function () { /* silent retry */ });
        }, 3000);
      })
      .catch(function (err) {
        panel.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>' + esc(err.message) + '</p></div>';
      });
  }

  function renderHsChatMessage(m) {
    var roleClass = m.role === 'user' ? 'user' : (m.role === 'agent' ? 'agent' : (m.role === 'system' ? 'system' : 'bot'));
    var roleLabel = m.role === 'user' ? '用户' : (m.role === 'agent' ? '客服' : (m.role === 'system' ? '系统' : 'AI'));
    var contentHtml = (m.role === 'bot' || m.role === 'assistant') ? renderMarkdown(m.content) : esc(m.content);
    if (m.role === 'system') {
      return '<div class="chat-record system">' +
        '<div>' +
          '<div class="record-bubble">' + esc(m.content) + '</div>' +
          '<div class="record-time" style="text-align:center;">' + fmtDate(m.created_at) + '</div>' +
        '</div>' +
      '</div>';
    }
    return '<div class="chat-record ' + roleClass + '">' +
      '<div class="role-tag">' + roleLabel + '</div>' +
      '<div>' +
        '<div class="record-bubble md-content">' + contentHtml + '</div>' +
        '<div class="record-time">' + fmtDate(m.created_at) + '</div>' +
      '</div>' +
    '</div>';
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
            '<td>' + fmtDate(u.first_seen_at) + '</td>' +
            '<td>' + fmtDate(u.last_seen_at) + '</td>' +
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
            '<td>' + fmtDate(e.created_at) + '</td>' +
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

  // ========== 智能体配置页面 ==========

  var agentsList = [];

  function renderAgents() {
    fetch(API_BASE + '/agents')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.code !== 0) throw new Error(data.message || '请求失败');
        agentsList = data.data || [];

        var html = '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">';
        html += '<h1 class="page-title" style="margin-bottom:0;">🤖 智能体配置</h1>';
        html += '<button class="back-btn" id="add-agent-btn" style="margin-bottom:0;background:#89b4fa;color:white;border-color:#89b4fa;">+ 新建智能体</button>';
        html += '</div>';

        if (agentsList.length === 0) {
          html += '<div class="empty-state"><div class="icon">🤖</div><p>暂无智能体，点击上方按钮创建</p></div>';
        } else {
          html += '<div class="agent-grid">';
          agentsList.forEach(function (agent) {
            html += renderAgentCard(agent);
          });
          html += '</div>';
        }

        app.innerHTML = html;

        // 绑定新建按钮
        document.getElementById('add-agent-btn').addEventListener('click', function () {
          openAgentModal(null);
        });

        // 绑定卡片操作按钮
        app.querySelectorAll('.btn-edit').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var agentId = this.getAttribute('data-id');
            var agent = agentsList.find(function (a) { return a.agent_id === agentId; });
            if (agent) openAgentModal(agent);
          });
        });

        app.querySelectorAll('.btn-default').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var agentId = this.getAttribute('data-id');
            setDefaultAgent(agentId);
          });
        });

        app.querySelectorAll('.btn-toggle').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var agentId = this.getAttribute('data-id');
            var agent = agentsList.find(function (a) { return a.agent_id === agentId; });
            if (agent) toggleAgentActive(agentId, !agent.is_active);
          });
        });

        app.querySelectorAll('.btn-delete').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var agentId = this.getAttribute('data-id');
            var agent = agentsList.find(function (a) { return a.agent_id === agentId; });
            if (agent && confirm('确定删除智能体「' + agent.name + '」吗？此操作不可恢复。')) {
              deleteAgent(agentId);
            }
          });
        });

        app.querySelectorAll('.btn-code').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var agentId = this.getAttribute('data-id');
            var agent = agentsList.find(function (a) { return a.agent_id === agentId; });
            if (agent) showEmbedCode(agent);
          });
        });
      })
      .catch(function (err) {
        app.innerHTML = '<div class="empty-state"><div class="icon">❌</div><p>加载失败: ' + esc(err.message) + '</p></div>';
      });
  }

  function renderAgentCard(agent) {
    var presets = agent.preset_questions || [];
    var color = agent.primary_color || '#667eea';
    var html = '<div class="agent-card' + (agent.is_default ? ' is-default' : '') + '">';

    html += '<div class="agent-header">';
    html += '<div class="agent-avatar" style="background:linear-gradient(135deg,' + esc(color) + ',#764ba2);">🤖</div>';
    html += '<div>';
    html += '<div class="agent-name">' + esc(agent.name) + '</div>';
    html += '<div class="agent-subtitle">' + esc(agent.subtitle || '') + '</div>';
    html += '</div></div>';

    html += '<div class="agent-badges">';
    if (agent.is_default) html += '<span class="tag tag-blue">默认</span>';
    html += agent.is_active ? '<span class="tag tag-green">启用</span>' : '<span class="tag tag-gray">停用</span>';
    html += '</div>';

    if (agent.welcome_message) {
      html += '<div class="agent-welcome">';
      html += '<div class="welcome-text">💬 ' + esc(agent.welcome_message) + '</div>';
      if (agent.welcome_message.length > 80) {
        html += '<span class="welcome-tooltip">' + esc(agent.welcome_message) + '</span>';
      }
      html += '</div>';
    }

    if (presets.length > 0) {
      html += '<div class="agent-presets">';
      presets.forEach(function (q) {
        html += '<span class="preset-tag">' + esc(q) + '</span>';
      });
      html += '</div>';
    }

    html += '<div class="agent-actions">';
    html += '<button class="btn-edit" data-id="' + esc(agent.agent_id) + '">✏️ 编辑</button>';
    if (!agent.is_default) {
      html += '<button class="btn-default" data-id="' + esc(agent.agent_id) + '">⭐ 设为默认</button>';
    }
    html += '<button class="btn-toggle" data-id="' + esc(agent.agent_id) + '">' + (agent.is_active ? '⏸ 停用' : '▶️ 启用') + '</button>';
    html += '<button class="btn-code" data-id="' + esc(agent.agent_id) + '">📋 接入代码</button>';
    html += '<button class="btn-delete" data-id="' + esc(agent.agent_id) + '">🗑 删除</button>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function openAgentModal(agent) {
    var isEdit = !!agent;
    var presets = (agent && agent.preset_questions) ? agent.preset_questions : ['你能做什么？', '帮我写代码'];

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'agent-modal';

    var html = '<div class="modal-box">';
    html += '<div class="modal-header"><span>' + (isEdit ? '编辑智能体' : '新建智能体') + '</span><button class="modal-close" id="modal-close-btn">✕</button></div>';
    html += '<div class="modal-body">';

    // 名称
    html += '<div class="form-group"><label>智能体名称 *</label>';
    html += '<input type="text" id="agent-name" value="' + esc(agent ? agent.name : '') + '" placeholder="例如：AI 助手"></div>';

    // 副标题
    html += '<div class="form-group"><label>副标题</label>';
    html += '<input type="text" id="agent-subtitle" value="' + esc(agent ? agent.subtitle : '随时为您解答') + '" placeholder="例如：随时为您解答"></div>';

    // 欢迎语
    html += '<div class="form-group"><label>欢迎消息</label>';
    html += '<textarea id="agent-welcome" rows="2" placeholder="用户打开聊天窗口时显示的第一条消息">' + esc(agent ? agent.welcome_message : '') + '</textarea></div>';

    // 主题色
    html += '<div class="form-group"><label>主题色</label>';
    html += '<div class="color-input-wrap">';
    html += '<input type="color" id="agent-color-picker" value="' + esc(agent ? agent.primary_color : '#667eea') + '">';
    html += '<input type="text" id="agent-color" value="' + esc(agent ? agent.primary_color : '#667eea') + '" placeholder="#667eea">';
    html += '</div></div>';

    // 预设问题
    html += '<div class="form-group"><label>预设问题</label>';
    html += '<div class="preset-list" id="preset-list">';
    presets.forEach(function (q, i) {
      html += '<div class="preset-item"><input type="text" class="preset-input" value="' + esc(q) + '" placeholder="预设问题 ' + (i + 1) + '"><button class="remove-preset" title="删除">✕</button></div>';
    });
    html += '</div>';
    html += '<button class="add-preset-btn" id="add-preset-btn">+ 添加预设问题</button>';
    html += '<div class="form-hint">建议 2~6 个预设问题，用户可以快速点击发送</div>';
    html += '</div>';

    // Bot ID
    html += '<div class="form-group"><label>Bot ID</label>';
    html += '<input type="text" id="agent-bot-id" value="' + esc(agent ? agent.bot_id : '') + '" placeholder="对接的 Bot ID"></div>';

    // Access Key ID
    html += '<div class="form-group"><label>Access Key ID</label>';
    html += '<input type="text" id="agent-ak-id" value="' + esc(agent ? agent.access_key_id : '') + '" placeholder="API 访问密钥 ID"></div>';

    // Access Key Secret
    html += '<div class="form-group"><label>Access Key Secret</label>';
    html += '<input type="text" id="agent-ak-secret" value="' + esc(agent ? agent.access_key_secret : '') + '" placeholder="API 访问密钥"></div>';

    // API Base
    html += '<div class="form-group"><label>API Base URL</label>';
    html += '<input type="text" id="agent-api-base" value="' + esc(agent ? agent.api_base : 'https://insight.juzibot.com') + '" placeholder="https://insight.juzibot.com"></div>';

    html += '</div>'; // modal-body

    html += '<div class="modal-footer">';
    html += '<button class="btn-cancel" id="modal-cancel-btn">取消</button>';
    html += '<button class="btn-save" id="modal-save-btn">' + (isEdit ? '保存修改' : '创建') + '</button>';
    html += '</div>';

    html += '</div>'; // modal-box
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    // 颜色选择器同步
    var colorPicker = document.getElementById('agent-color-picker');
    var colorInput = document.getElementById('agent-color');
    colorPicker.addEventListener('input', function () { colorInput.value = this.value; });
    colorInput.addEventListener('input', function () {
      if (/^#[0-9a-fA-F]{6}$/.test(this.value)) colorPicker.value = this.value;
    });

    // 添加预设问题
    document.getElementById('add-preset-btn').addEventListener('click', function () {
      var list = document.getElementById('preset-list');
      var count = list.querySelectorAll('.preset-item').length;
      var item = document.createElement('div');
      item.className = 'preset-item';
      item.innerHTML = '<input type="text" class="preset-input" value="" placeholder="预设问题 ' + (count + 1) + '"><button class="remove-preset" title="删除">✕</button>';
      list.appendChild(item);
      item.querySelector('.remove-preset').addEventListener('click', function () { item.remove(); });
      item.querySelector('input').focus();
    });

    // 删除预设问题
    overlay.querySelectorAll('.remove-preset').forEach(function (btn) {
      btn.addEventListener('click', function () { this.parentElement.remove(); });
    });

    // 关闭弹窗
    function closeModal() { overlay.remove(); }
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

    // 保存
    document.getElementById('modal-save-btn').addEventListener('click', function () {
      var name = document.getElementById('agent-name').value.trim();
      if (!name) { alert('请输入智能体名称'); return; }

      var presetInputs = document.querySelectorAll('#preset-list .preset-input');
      var questions = [];
      presetInputs.forEach(function (inp) {
        var v = inp.value.trim();
        if (v) questions.push(v);
      });

      var payload = {
        name: name,
        subtitle: document.getElementById('agent-subtitle').value.trim(),
        welcome_message: document.getElementById('agent-welcome').value.trim(),
        primary_color: document.getElementById('agent-color').value.trim() || '#667eea',
        preset_questions: questions,
        bot_id: document.getElementById('agent-bot-id').value.trim(),
        access_key_id: document.getElementById('agent-ak-id').value.trim(),
        access_key_secret: document.getElementById('agent-ak-secret').value.trim(),
        api_base: document.getElementById('agent-api-base').value.trim() || 'https://insight.juzibot.com'
      };

      var saveBtn = document.getElementById('modal-save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';

      var url = isEdit ? (API_BASE + '/agents/' + agent.agent_id) : (API_BASE + '/agents');
      var method = isEdit ? 'PUT' : 'POST';

      fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.code !== 0) throw new Error(data.message || '操作失败');
          closeModal();
          renderAgents();
        })
        .catch(function (err) {
          alert('操作失败: ' + err.message);
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? '保存修改' : '创建';
        });
    });
  }

  function setDefaultAgent(agentId) {
    fetch(API_BASE + '/agents/' + agentId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_default: true })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.code !== 0) throw new Error(data.message || '操作失败');
        renderAgents();
      })
      .catch(function (err) { alert('设置默认失败: ' + err.message); });
  }

  function toggleAgentActive(agentId, active) {
    fetch(API_BASE + '/agents/' + agentId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: active })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.code !== 0) throw new Error(data.message || '操作失败');
        renderAgents();
      })
      .catch(function (err) { alert('操作失败: ' + err.message); });
  }

  function deleteAgent(agentId) {
    fetch(API_BASE + '/agents/' + agentId, { method: 'DELETE' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.code !== 0) throw new Error(data.message || '删除失败');
        renderAgents();
      })
      .catch(function (err) { alert('删除失败: ' + err.message); });
  }

  function showEmbedCode(agent) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    var scriptUrl = location.origin + '/chat-widget.js';
    var code1 = '<script src="' + scriptUrl + '"></scr' + 'ipt>\n<script>\n  AIChatWidget.init({\n    agentId: \'' + agent.agent_id + '\'\n  });\n</scr' + 'ipt>';
    var code2 = '<script src="' + scriptUrl + '"></scr' + 'ipt>';

    var html = '<div class="modal-box" style="width:620px;">';
    html += '<div class="modal-header"><span>📋 接入代码 — ' + esc(agent.name) + '</span><button class="modal-close" id="code-modal-close">✕</button></div>';
    html += '<div class="modal-body">';

    html += '<div class="form-group"><label>方式一：指定此智能体（推荐多站点 / 多智能体场景）</label>';
    html += '<div style="position:relative;">';
    html += '<pre style="background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:8px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-all;" id="embed-code-1">' + esc(code1) + '</pre>';
    html += '<button class="copy-code-btn" data-target="embed-code-1" style="position:absolute;top:8px;right:8px;padding:4px 10px;border:none;background:rgba(255,255,255,0.15);color:#cdd6f4;border-radius:4px;cursor:pointer;font-size:12px;">复制</button>';
    html += '</div>';
    html += '<div class="form-hint">粘贴到目标网站 &lt;body&gt; 底部，该网站将始终使用此智能体</div></div>';

    if (agent.is_default) {
      html += '<div class="form-group"><label>方式二：使用默认智能体（当前已是默认）</label>';
      html += '<div style="position:relative;">';
      html += '<pre style="background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:8px;font-size:13px;line-height:1.6;" id="embed-code-2">' + esc(code2) + '</pre>';
      html += '<button class="copy-code-btn" data-target="embed-code-2" style="position:absolute;top:8px;right:8px;padding:4px 10px;border:none;background:rgba(255,255,255,0.15);color:#cdd6f4;border-radius:4px;cursor:pointer;font-size:12px;">复制</button>';
      html += '</div>';
      html += '<div class="form-hint">无需指定 agentId，自动使用后台的默认智能体。切换默认后所有此方式接入的站点自动跟着变</div></div>';
    }

    html += '<div class="form-group" style="margin-bottom:0;"><label>Agent ID</label>';
    html += '<div style="display:flex;gap:8px;align-items:center;">';
    html += '<input type="text" value="' + esc(agent.agent_id) + '" readonly style="flex:1;background:#f8f9fa;" id="agent-id-copy">';
    html += '<button id="copy-agent-id-btn" style="padding:6px 14px;border:1px solid #ddd;border-radius:6px;background:white;cursor:pointer;font-size:12px;">复制</button>';
    html += '</div></div>';

    html += '</div>';
    html += '<div class="modal-footer"><button class="btn-cancel" id="code-modal-cancel">关闭</button></div>';
    html += '</div>';

    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    function closeModal() { overlay.remove(); }
    document.getElementById('code-modal-close').addEventListener('click', closeModal);
    document.getElementById('code-modal-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

    // 复制按钮
    overlay.querySelectorAll('.copy-code-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = document.getElementById(this.getAttribute('data-target'));
        if (target) {
          navigator.clipboard.writeText(target.textContent).then(function () {
            btn.textContent = '已复制';
            setTimeout(function () { btn.textContent = '复制'; }, 1500);
          });
        }
      });
    });

    document.getElementById('copy-agent-id-btn').addEventListener('click', function () {
      var input = document.getElementById('agent-id-copy');
      navigator.clipboard.writeText(input.value).then(function () {
        document.getElementById('copy-agent-id-btn').textContent = '已复制';
        setTimeout(function () { document.getElementById('copy-agent-id-btn').textContent = '复制'; }, 1500);
      });
    });
  }

  // ========== Markdown 渲染 ==========
  function renderMarkdown(src) {
    if (!src) return '';
    var codeBlocks = [];
    src = src.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
      var idx = codeBlocks.length;
      codeBlocks.push('<pre class="md-code-block"><div class="md-code-header">' +
        (lang ? '<span class="md-code-lang">' + esc(lang) + '</span>' : '') +
        '<button class="md-copy-btn" onclick="(function(b){var c=b.parentElement.nextElementSibling;var t=c.textContent;navigator.clipboard.writeText(t).then(function(){b.textContent=\'已复制\';setTimeout(function(){b.textContent=\'复制\'},1500)});})(this)">复制</button>' +
        '</div><code>' + esc(code) + '</code></pre>');
      return '\x00CODEBLOCK' + idx + '\x00';
    });

    var inlineCodes = [];
    src = src.replace(/`([^`\n]+)`/g, function (_, code) {
      var idx = inlineCodes.length;
      inlineCodes.push('<code class="md-inline-code">' + esc(code) + '</code>');
      return '\x00INLINE' + idx + '\x00';
    });

    var lines = src.split('\n');
    var html = '';
    var inList = false;
    var inOrderedList = false;
    var inBlockquote = false;
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line.trim())) {
        if (inList) { html += '</ul>'; inList = false; }
        if (inOrderedList) { html += '</ol>'; inOrderedList = false; }
        if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }
        html += '<hr class="md-hr">';
        i++; continue;
      }

      var headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        if (inList) { html += '</ul>'; inList = false; }
        if (inOrderedList) { html += '</ol>'; inOrderedList = false; }
        if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }
        var level = headerMatch[1].length;
        html += '<h' + level + ' class="md-h md-h' + level + '">' + inlineFmt(headerMatch[2]) + '</h' + level + '>';
        i++; continue;
      }

      var bqMatch = line.match(/^>\s?(.*)$/);
      if (bqMatch) {
        if (inList) { html += '</ul>'; inList = false; }
        if (inOrderedList) { html += '</ol>'; inOrderedList = false; }
        if (!inBlockquote) { html += '<blockquote class="md-blockquote">'; inBlockquote = true; }
        html += inlineFmt(bqMatch[1]) + '<br>';
        i++; continue;
      } else if (inBlockquote) {
        html += '</blockquote>'; inBlockquote = false;
      }

      var ulMatch = line.match(/^[\s]*[-*•]\s+(.+)$/);
      if (ulMatch) {
        if (inOrderedList) { html += '</ol>'; inOrderedList = false; }
        if (!inList) { html += '<ul class="md-ul">'; inList = true; }
        html += '<li>' + inlineFmt(ulMatch[1]) + '</li>';
        i++; continue;
      } else if (inList) {
        html += '</ul>'; inList = false;
      }

      var olMatch = line.match(/^[\s]*(\d+)[.)]\s+(.+)$/);
      if (olMatch) {
        if (inList) { html += '</ul>'; inList = false; }
        if (!inOrderedList) { html += '<ol class="md-ol">'; inOrderedList = true; }
        html += '<li>' + inlineFmt(olMatch[2]) + '</li>';
        i++; continue;
      } else if (inOrderedList) {
        html += '</ol>'; inOrderedList = false;
      }

      if (line.indexOf('|') !== -1 && i + 1 < lines.length && /^\|?[\s-:|]+\|?$/.test(lines[i + 1].trim())) {
        var tableResult = parseMdTable(lines, i);
        if (tableResult.html) {
          html += tableResult.html;
          i = tableResult.endIndex;
          continue;
        }
      }

      if (line.trim() === '') {
        html += '<br>';
        i++; continue;
      }

      html += '<p class="md-p">' + inlineFmt(line) + '</p>';
      i++;
    }

    if (inList) html += '</ul>';
    if (inOrderedList) html += '</ol>';
    if (inBlockquote) html += '</blockquote>';

    for (var c = 0; c < codeBlocks.length; c++) {
      html = html.replace('\x00CODEBLOCK' + c + '\x00', codeBlocks[c]);
    }
    for (var d = 0; d < inlineCodes.length; d++) {
      html = html.replace('\x00INLINE' + d + '\x00', inlineCodes[d]);
    }

    return html;
  }

  function inlineFmt(text) {
    var s = esc(text);
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>');
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="md-img">');
    return s;
  }

  function parseMdTable(lines, startIdx) {
    var headerLine = lines[startIdx].trim();
    var sepLine = lines[startIdx + 1].trim();
    if (!/^\|?[\s-:|]+\|?$/.test(sepLine)) return { html: '', endIndex: startIdx + 1 };

    var headers = splitMdRow(headerLine);
    var aligns = sepLine.split('|').filter(function (c) { return c.trim(); }).map(function (c) {
      c = c.trim();
      if (c[0] === ':' && c[c.length - 1] === ':') return 'center';
      if (c[c.length - 1] === ':') return 'right';
      return 'left';
    });

    var html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
    for (var h = 0; h < headers.length; h++) {
      html += '<th style="text-align:' + (aligns[h] || 'left') + '">' + inlineFmt(headers[h]) + '</th>';
    }
    html += '</tr></thead><tbody>';

    var idx = startIdx + 2;
    while (idx < lines.length && lines[idx].trim() && lines[idx].indexOf('|') !== -1) {
      var cells = splitMdRow(lines[idx].trim());
      html += '<tr>';
      for (var c = 0; c < headers.length; c++) {
        html += '<td style="text-align:' + (aligns[c] || 'left') + '">' + inlineFmt(cells[c] || '') + '</td>';
      }
      html += '</tr>';
      idx++;
    }

    html += '</tbody></table></div>';
    return { html: html, endIndex: idx };
  }

  function splitMdRow(row) {
    if (row[0] === '|') row = row.substring(1);
    if (row[row.length - 1] === '|') row = row.substring(0, row.length - 1);
    return row.split('|').map(function (c) { return c.trim(); });
  }

  // ========== 工具函数 ==========
  function esc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function fmtDate(str) {
    if (!str) return '';
    var d = new Date(str);
    if (isNaN(d.getTime())) return esc(str);
    var Y = d.getFullYear();
    var M = ('0' + (d.getMonth() + 1)).slice(-2);
    var D = ('0' + d.getDate()).slice(-2);
    var h = ('0' + d.getHours()).slice(-2);
    var m = ('0' + d.getMinutes()).slice(-2);
    var s = ('0' + d.getSeconds()).slice(-2);
    return Y + '-' + M + '-' + D + ' ' + h + ':' + m + ':' + s;
  }

  // ========== 初始化 ==========
  renderPage(initialPage);

})();

