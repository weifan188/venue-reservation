'use strict';

// ============================================================
//  全域狀態
// ============================================================
const App = {
  tokenClient:      null,
  calendar:         null,
  currentUser:      null,
  _gapiReady:       false,
  _gisReady:        false,
  _myBookings:      [],       // 快取，供取消操作使用
  _pendingEvent:    null,     // 目前詳情 modal 所顯示的事件
  _pendingCalId:    null,
  _toastTimer:      null,

  // ──────────────────────────────────────────────────────────
  //  Google API 初始化
  // ──────────────────────────────────────────────────────────

  onGapiLoad() {
    gapi.load('client', async () => {
      try {
        await gapi.client.init({
          apiKey:        CONFIG.API_KEY,
          discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
        });
        App._gapiReady = true;
        App._checkReady();
      } catch (e) {
        console.error('GAPI 初始化失敗:', e);
        App.toast('Google API 初始化失敗，請重新整理頁面', 'error');
      }
    });
  },

  onGisLoad() {
    App._gisReady = true;
    App._checkReady();
  },

  _checkReady() {
    if (App._gapiReady && App._gisReady) {
      // 檢查是否從 OAuth redirect 回來（URL hash 含 access_token）
      const hash = new URLSearchParams(window.location.hash.substring(1));
      const token = hash.get('access_token');
      if (token) {
        // 清除 URL hash 避免 token 外洩
        history.replaceState(null, '', window.location.pathname + window.location.search);
        gapi.client.setToken({ access_token: token });
        App._fetchUserInfo();
      } else {
        document.getElementById('signin-btn').disabled = false;
      }
    }
  },

  async _fetchUserInfo() {
    const token = gapi.client.getToken();
    if (!token) return;
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      App.currentUser = await r.json();
      App._showApp();
    } catch (e) {
      console.error('取得使用者資訊失敗:', e);
      App.toast('無法取得帳號資訊，請重試', 'error');
    }
  },

  // ──────────────────────────────────────────────────────────
  //  登入 / 登出
  // ──────────────────────────────────────────────────────────

  signIn() {
    if (!App._gapiReady || !App._gisReady) {
      App.toast('初始化中，請稍後再試', 'error');
      return;
    }
    // GitHub Pages 設有 COOP 標頭，改用 redirect 流程避免 popup 被封鎖
    const redirectUri = window.location.href.split('#')[0];
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id',              CONFIG.CLIENT_ID);
    authUrl.searchParams.set('redirect_uri',           redirectUri);
    authUrl.searchParams.set('response_type',          'token');
    authUrl.searchParams.set('scope',                  CONFIG.SCOPES);
    authUrl.searchParams.set('include_granted_scopes', 'true');
    window.location.href = authUrl.toString();
  },

  signOut() {
    const token = gapi.client.getToken();
    if (token?.access_token) {
      google.accounts.oauth2.revoke(token.access_token, () => {});
    }
    gapi.client.setToken(null);
    App.currentUser = null;
    if (App.calendar) {
      App.calendar.destroy();
      App.calendar = null;
    }
    App._showLogin();
  },

  // ──────────────────────────────────────────────────────────
  //  頁面切換
  // ──────────────────────────────────────────────────────────

  _showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display           = 'none';
  },

  _showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display           = 'block';

    const u = App.currentUser;
    document.getElementById('user-name').textContent = u.name || u.email;
    const avatar = document.getElementById('user-avatar');
    if (u.picture) avatar.src = u.picture;

    App._renderVenueFilters();
    App._initCalendar();
    App._loadMyBookings();
  },

  // ──────────────────────────────────────────────────────────
  //  場地篩選 Tabs
  // ──────────────────────────────────────────────────────────

  _renderVenueFilters() {
    const nav = document.getElementById('venue-filters');
    nav.innerHTML = '';

    // 「全部」按鈕
    nav.appendChild(App._makeFilterBtn('all', '全部場地', null, true));

    CONFIG.VENUES.forEach(v => {
      nav.appendChild(App._makeFilterBtn(v.id, v.name, v.color, false));
    });
  },

  _makeFilterBtn(id, label, color, active) {
    const btn = document.createElement('button');
    btn.className     = 'venue-btn' + (active ? ' active' : '');
    btn.dataset.venue = id;

    if (color) {
      const dot = document.createElement('span');
      dot.className = 'venue-dot';
      dot.style.background = color;
      btn.appendChild(dot);
    }
    btn.appendChild(document.createTextNode(label));

    btn.addEventListener('click', () => {
      document.querySelectorAll('.venue-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      App._filterVenue(id);
    });
    return btn;
  },

  _filterVenue(venueId) {
    if (!App.calendar) return;
    App.calendar.getEventSources().forEach(s => s.remove());

    const targets = venueId === 'all'
      ? CONFIG.VENUES
      : CONFIG.VENUES.filter(v => v.id === venueId);

    targets.forEach(v => App._addEventSource(v));
  },

  // ──────────────────────────────────────────────────────────
  //  FullCalendar 初始化
  // ──────────────────────────────────────────────────────────

  _initCalendar() {
    const el = document.getElementById('calendar');

    App.calendar = new FullCalendar.Calendar(el, {
      locale:       'zh-tw',
      initialView:  window.innerWidth < 768 ? 'timeGridDay' : 'timeGridWeek',
      headerToolbar: {
        left:   'prev,next today',
        center: 'title',
        right:  'timeGridWeek,timeGridDay',
      },
      buttonText: { today: '今天', week: '週', day: '日' },
      height:        'auto',
      slotMinTime:   CONFIG.BUSINESS_HOURS.startTime + ':00',
      slotMaxTime:   CONFIG.BUSINESS_HOURS.endTime   + ':00',
      slotDuration:  '00:30:00',
      snapDuration:  '00:30:00',
      allDaySlot:    false,
      businessHours: CONFIG.BUSINESS_HOURS,
      selectable:    true,
      selectMirror:  true,
      unselectAuto:  true,
      nowIndicator:  true,
      eventMaxStack: 3,

      select(info)      { App._openBookingModal(info); },
      eventClick(info)  { App._showEventDetail(info.event); },
    });

    App.calendar.render();
    CONFIG.VENUES.forEach(v => App._addEventSource(v));
  },

  _addEventSource(venue) {
    App.calendar.addEventSource({
      id:    venue.id,
      color: venue.color,

      events: async (fetchInfo, successCb, failureCb) => {
        try {
          const resp = await gapi.client.calendar.events.list({
            calendarId: venue.id,
            timeMin:    fetchInfo.startStr,
            timeMax:    fetchInfo.endStr,
            singleEvents: true,
            orderBy:    'startTime',
          });
          const items = resp.result.items || [];
          successCb(items.map(e => ({
            id:    e.id,
            title: e.summary || '（無標題）',
            start: e.start.dateTime || e.start.date,
            end:   e.end.dateTime   || e.end.date,
            color: venue.color,
            extendedProps: {
              calendarId:   venue.id,
              venueName:    venue.name,
              venueColor:   venue.color,
              description:  e.description || '',
              creatorEmail: e.creator?.email || '',
            },
          })));
        } catch (err) {
          console.error(`載入「${venue.name}」行事曆失敗:`, err);
          if (err.status === 401) App.signOut();
          failureCb(err);
        }
      },
    });
  },

  // ──────────────────────────────────────────────────────────
  //  預約 Modal
  // ──────────────────────────────────────────────────────────

  _openBookingModal(selectInfo) {
    const start = selectInfo.start;
    let   end   = selectInfo.end;

    // 若只點一下（不足 30 分），預設補為 1 小時
    if (end - start < CONFIG.MIN_MINUTES * 60 * 1000) {
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }

    // 填入場地選單
    const sel = document.getElementById('f-venue');
    sel.innerHTML = CONFIG.VENUES
      .map(v => `<option value="${_esc(v.id)}">${_esc(v.name)}</option>`)
      .join('');

    // 填入日期時間
    document.getElementById('f-date').value         = _toDateStr(start);
    document.getElementById('f-date-display').textContent = _fmtDate(start);
    document.getElementById('f-start').value        = _toTimeStr(start);
    document.getElementById('f-end').value          = _toTimeStr(end);
    document.getElementById('f-purpose').value      = '';
    document.getElementById('f-notes').value        = '';

    const btn = document.getElementById('submit-btn');
    btn.disabled    = false;
    btn.textContent = '確認預約';

    App.openModal('booking-modal');
  },

  async submitBooking() {
    const venueId = document.getElementById('f-venue').value;
    const date    = document.getElementById('f-date').value;
    const sTime   = document.getElementById('f-start').value;
    const eTime   = document.getElementById('f-end').value;
    const purpose = document.getElementById('f-purpose').value.trim();
    const notes   = document.getElementById('f-notes').value.trim();

    if (!purpose) {
      App.toast('請填寫借用目的', 'error');
      return;
    }

    const startDT = new Date(`${date}T${sTime}`);
    const endDT   = new Date(`${date}T${eTime}`);

    if (isNaN(startDT) || isNaN(endDT)) {
      App.toast('時間格式有誤，請重新輸入', 'error');
      return;
    }
    if (endDT <= startDT) {
      App.toast('結束時間必須晚於開始時間', 'error');
      return;
    }
    const diffMin = (endDT - startDT) / 60000;
    if (diffMin < CONFIG.MIN_MINUTES) {
      App.toast(`最短借用時間為 ${CONFIG.MIN_MINUTES} 分鐘`, 'error');
      return;
    }
    if (diffMin > CONFIG.MAX_HOURS * 60) {
      App.toast(`最長借用時間為 ${CONFIG.MAX_HOURS} 小時`, 'error');
      return;
    }

    const btn = document.getElementById('submit-btn');
    btn.disabled    = true;
    btn.textContent = '檢查時段中…';

    try {
      const conflict = await App._checkConflict(venueId, startDT, endDT);
      if (conflict) {
        App.toast('此時段已有預約，請選擇其他時段', 'error');
        btn.disabled    = false;
        btn.textContent = '確認預約';
        return;
      }

      btn.textContent = '建立中…';

      const venueName = CONFIG.VENUES.find(v => v.id === venueId)?.name || '';
      const desc = [
        `借用人：${App.currentUser.name} (${App.currentUser.email})`,
        `場地：${venueName}`,
        `目的：${purpose}`,
        notes ? `備註：${notes}` : null,
      ].filter(Boolean).join('\n');

      await gapi.client.calendar.events.insert({
        calendarId: venueId,
        resource: {
          summary:     `[借用] ${purpose}`,
          description: desc,
          start: { dateTime: startDT.toISOString() },
          end:   { dateTime: endDT.toISOString()   },
        },
      });

      App.closeModal('booking-modal');
      App.calendar.refetchEvents();
      App._loadMyBookings();
      App.toast('預約成功！', 'success');

    } catch (err) {
      console.error('submitBooking 失敗:', err);
      App.toast('預約失敗，請重試', 'error');
      btn.disabled    = false;
      btn.textContent = '確認預約';
    }
  },

  async _checkConflict(calendarId, start, end) {
    const resp = await gapi.client.calendar.events.list({
      calendarId,
      timeMin:      start.toISOString(),
      timeMax:      end.toISOString(),
      singleEvents: true,
      maxResults:   1,
    });
    return (resp.result.items || []).length > 0;
  },

  // ──────────────────────────────────────────────────────────
  //  事件詳情 Modal
  // ──────────────────────────────────────────────────────────

  _showEventDetail(event) {
    const p = event.extendedProps;
    App._pendingEvent = event;
    App._pendingCalId = p.calendarId;

    const badge = document.getElementById('d-venue-badge');
    badge.textContent   = _esc(p.venueName || '');
    badge.style.background = p.venueColor || '#666';

    document.getElementById('d-time').textContent =
      `${_fmtDateTime(event.start)} ─ ${_fmtTime(event.end)}`;

    document.getElementById('d-title').textContent = event.title;

    const descEl  = document.getElementById('d-desc');
    const descRow = document.getElementById('d-desc-row');
    if (p.description) {
      descEl.textContent    = p.description;
      descRow.style.display = 'block';
    } else {
      descRow.style.display = 'none';
    }

    const cancelBtn = document.getElementById('d-cancel-btn');
    cancelBtn.style.display =
      (p.creatorEmail === App.currentUser?.email) ? 'inline-block' : 'none';

    App.openModal('event-modal');
  },

  async cancelCurrentEvent() {
    if (!confirm('確定要取消此預約？此動作無法復原。')) return;
    try {
      await gapi.client.calendar.events.delete({
        calendarId: App._pendingCalId,
        eventId:    App._pendingEvent.id,
      });
      App.closeModal('event-modal');
      App.calendar.refetchEvents();
      App._loadMyBookings();
      App.toast('預約已取消', 'success');
    } catch (err) {
      console.error('cancelCurrentEvent 失敗:', err);
      App.toast('取消失敗，請重試', 'error');
    }
  },

  // ──────────────────────────────────────────────────────────
  //  我的預約（未來 30 天）
  // ──────────────────────────────────────────────────────────

  async _loadMyBookings() {
    const container = document.getElementById('my-bookings-list');
    container.innerHTML = '<div class="empty-state">載入中…</div>';

    const now    = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const email  = App.currentUser?.email;
    const all    = [];

    await Promise.allSettled(CONFIG.VENUES.map(async (venue) => {
      try {
        const resp = await gapi.client.calendar.events.list({
          calendarId:   venue.id,
          timeMin:      now.toISOString(),
          timeMax:      future.toISOString(),
          singleEvents: true,
          orderBy:      'startTime',
        });
        (resp.result.items || [])
          .filter(e => e.creator?.email === email)
          .forEach(e => all.push({ ...e, _venue: venue }));
      } catch (_) {
        // 若無此日曆存取權限，靜默略過
      }
    }));

    all.sort((a, b) =>
      new Date(a.start.dateTime) - new Date(b.start.dateTime)
    );

    App._myBookings = all;

    if (all.length === 0) {
      container.innerHTML = '<div class="empty-state">未來 30 天內沒有預約</div>';
      return;
    }

    container.innerHTML = all.map((b, i) => `
      <div class="booking-item" style="border-left-color:${b._venue.color}">
        <div class="booking-info">
          <div class="booking-title">${_esc(b.summary || '（無標題）')}</div>
          <div class="booking-meta">${_esc(b._venue.name)}</div>
          <div class="booking-meta">
            ${_fmtDateTime(new Date(b.start.dateTime))}
            ─
            ${_fmtTime(new Date(b.end.dateTime))}
          </div>
        </div>
        <button class="btn-outline-danger" data-index="${i}">取消</button>
      </div>
    `).join('');

    container.querySelectorAll('[data-index]').forEach(btn => {
      btn.addEventListener('click', () => {
        App._cancelFromList(parseInt(btn.dataset.index, 10));
      });
    });
  },

  async _cancelFromList(index) {
    const b = App._myBookings[index];
    if (!b) return;
    if (!confirm('確定要取消此預約？')) return;
    try {
      await gapi.client.calendar.events.delete({
        calendarId: b._venue.id,
        eventId:    b.id,
      });
      App.calendar.refetchEvents();
      App._loadMyBookings();
      App.toast('預約已取消', 'success');
    } catch (err) {
      console.error('_cancelFromList 失敗:', err);
      App.toast('取消失敗，請重試', 'error');
    }
  },

  // ──────────────────────────────────────────────────────────
  //  Modal 輔助
  // ──────────────────────────────────────────────────────────

  openModal(id) {
    document.getElementById(id).style.display = 'flex';
  },

  closeModal(id) {
    document.getElementById(id).style.display = 'none';
    if (id === 'booking-modal') App.calendar?.unselect();
  },

  // ──────────────────────────────────────────────────────────
  //  Toast 通知
  // ──────────────────────────────────────────────────────────

  toast(message, type = 'info') {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className   = `toast show ${type}`;
    clearTimeout(App._toastTimer);
    App._toastTimer = setTimeout(() => {
      el.className = 'toast';
    }, 3500);
  },
};

// ============================================================
//  日期時間工具函式
// ============================================================

function _toDateStr(d) {
  // 回傳 YYYY-MM-DD（使用 sv locale 當作 ISO-like 格式）
  return d.toLocaleDateString('sv');
}

function _toTimeStr(d) {
  return d.toLocaleTimeString('sv', { hour: '2-digit', minute: '2-digit' });
}

function _fmtDate(d) {
  return d.toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });
}

function _fmtTime(d) {
  return d.toLocaleTimeString('zh-TW', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function _fmtDateTime(d) {
  return d.toLocaleString('zh-TW', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
