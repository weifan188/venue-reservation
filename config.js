// ============================================================
//  場地借用平台 — 設定檔
//  請依照下方說明填入正確的值後再部署
// ============================================================

const CONFIG = {

  // ── Google Cloud Console 設定 ───────────────────────────
  // 1. 前往 https://console.cloud.google.com/
  // 2. 建立新專案（或選擇現有專案）
  // 3. 啟用 Google Calendar API
  // 4. 建立「OAuth 2.0 用戶端 ID」（類型：Web 應用程式）
  //    - 已授權的 JavaScript 來源：https://<你的帳號>.github.io
  //    - 已授權的重新導向 URI：https://<你的帳號>.github.io/<repo名稱>/
  // 5. 建立「API 金鑰」並限制只允許 Calendar API

  CLIENT_ID: '637597173026-bsaoik6gbs98ohre0jjndd8gd8p14vnf.apps.googleusercontent.com',
  API_KEY:   'AIzaSyDzACwhyFS6PPV7NBAbceaRQcJ8vyVxT7U',

  SCOPES: [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
  ].join(' '),

  // ── 場地設定 ────────────────────────────────────────────
  // 取得 Calendar ID 的方式：
  //   Google 日曆 → 場地日曆右側「⋮」→「設定和共用」
  //   → 拉到最底部「整合日曆」→ 複製「日曆 ID」
  //
  // 權限設定：每個場地日曆必須分享給所有使用者「可以編輯活動」
  //   「設定和共用」→「存取權限」→ 勾選「讓組織中的所有人查看此日曆」
  //   或直接新增學校網域並給予「可以編輯活動」權限

  VENUES: [
    {
      id:    'c_4k2ecf4s3i8pab8j94ag04v4ls@group.calendar.google.com',
      name:  '數位自主教室二（活動中心二樓）',
      color: '#4285F4',
    },
    {
      id:    'VENUE_2_CALENDAR_ID@group.calendar.google.com',
      name:  '場地二',
      color: '#0F9D58',
    },
    {
      id:    'VENUE_3_CALENDAR_ID@group.calendar.google.com',
      name:  '場地三',
      color: '#F4B400',
    },
    {
      id:    'VENUE_4_CALENDAR_ID@group.calendar.google.com',
      name:  '場地四',
      color: '#DB4437',
    },
    {
      id:    'VENUE_5_CALENDAR_ID@group.calendar.google.com',
      name:  '場地五',
      color: '#9C27B0',
    },
  ],

  // ── 開放時段（FullCalendar businessHours 格式）──────────
  BUSINESS_HOURS: {
    daysOfWeek: [1, 2, 3, 4, 5],   // 週一～週五
    startTime:  '07:30',
    endTime:    '21:00',
  },

  // ── 借用規則 ─────────────────────────────────────────────
  MIN_MINUTES: 30,    // 最短借用時間（分鐘）
  MAX_HOURS:   8,     // 最長借用時間（小時）
};
