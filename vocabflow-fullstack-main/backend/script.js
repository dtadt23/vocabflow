/* ==========================================================================
   VocabFlow — script.js  |  Session-based AI Chat + Full App Logic
   ========================================================================== */

const BACKEND_API_URL =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:5000/api"
    : "https://backend-late-bird-6083.fly.dev/api";

window.BACKEND_API_URL = BACKEND_API_URL;

// Kiểm tra bảo trì khi load trang (trước khi login)
(async function checkMaintenanceOnLoad() {
  try {
    // Dùng endpoint nhẹ, không cần auth
    const res = await fetch(`${BACKEND_API_URL}/test_db`).catch(() => null);
    if (res && res.status === 503) {
      const data = await res.json().catch(() => ({}));
      if (data.maintenance) showMaintenanceOverlay(data);
    }
  } catch {}
})();

// =========================================================
// APPLICATION STATE
// =========================================================
const defaultDecks = [
  {
    id: "deck-default-1",
    name: "Từ Vựng Tiếng Anh Cơ Bản",
    words: [
      { id: "word-1", word: "Serendipity", ipa: "/ˌsɛrənˈdɪpəti/", meaning: "Sự tình cờ may mắn", example: { en: "Finding that old book was pure serendipity.", vi: "Tìm thấy cuốn sách cũ đó là một sự tình cờ may mắn." } },
      { id: "word-2", word: "Ephemeral", ipa: "/ɪˈfɛmərəl/", meaning: "Kéo dài rất ngắn, phù du", example: { en: "The beauty of cherry blossoms is ephemeral.", vi: "Vẻ đẹp của hoa anh đào thật phù du." } },
      { id: "word-3", word: "Ubiquitous", ipa: "/juːˈbɪkwɪtəs/", meaning: "Phổ biến khắp mọi nơi", example: { en: "Smartphones have become ubiquitous in modern society.", vi: "Điện thoại thông minh đã trở nên phổ biến khắp mọi nơi." } },
      { id: "word-4", word: "Mellifluous", ipa: "/məˈlɪfluəs/", meaning: "Ngọt ngào hoặc du dương", example: { en: "Her mellifluous voice captivated the entire audience.", vi: "Giọng hát du dương của cô ấy đã mê hoặc toàn bộ khán giả." } },
      { id: "word-5", word: "Cogent", ipa: "/ˈkoʊdʒənt/", meaning: "Rõ ràng, hợp lý và thuyết phục", example: { en: "She presented a cogent argument for renewable energy.", vi: "Cô ấy đã trình bày một lập luận chặt chẽ về năng lượng tái tạo." } },
    ],
  },
];

let decks = [];
let progress = {};
let activeDeckId = null;
let currentIndex = 0;
let isFlipped = false;
let editingDeckId = null;
let currentUser = null;
let _initDone = false; // flag để biết init() đã xong chưa
let currentView = (() => {
  try {
    const v = sessionStorage.getItem('vocabflow_view') || 'dashboard';
    // "group" là external page, không phải view của index.html → fallback dashboard
    const validViews = ['dashboard', 'review', 'wordlist', 'progress', 'settings', 'group'];
    return validViews.includes(v) ? v : 'dashboard';
  } catch { return 'dashboard'; }
})();
let _viewSetByUser = false; // user đã chủ động chọn tab trong khi init chưa xong

// =========================================================
// CHAT STATE — SESSION-BASED
// =========================================================
let chatSessions = [];
let activeSessionId = null;
let activeSessionMessages = [];
const INITIAL_BOT_MESSAGE = "Xin chào! Tôi là AI Coach của VocabFlow. Bạn muốn luyện tập về từ vựng hay ngữ pháp nào hôm nay?";
let chatLayoutRendered = false;

// =========================================================
// REVIEW STATE
// =========================================================
let reviewMode = null;
let reviewDeckId = null;
let reviewWordList = [];

// ── Group Study State ─────────────────────────────────────
let groupStudyMode = false;
let groupStudyDeck = null;
let groupStudyGroupId = null;
let activeGroupDeck = null; // deck nhóm đang học, tách riêng khỏi decks[]
let reviewTotalWordsPool = [];
let reviewCurrentIndex = 0;
let reviewScore = 0;
let reviewTotalQuestions = 0;
let reviewTimerInterval = null;
let timeLeft = 15;
let aiPreviewWords = [];

// Charts
let difficultyChart = null;
let dailyWordsChart = null;

// =========================================================
// DOM ELEMENTS
// =========================================================
const elements = {
  reviewCountSelect: document.getElementById("review-count-select"),
  reviewTimerVal: document.getElementById("review-timer-val"),
  deckList: document.getElementById("deck-list"),
  createDeckBtn: document.getElementById("create-deck-btn"),
  deckModal: document.getElementById("deck-modal"),
  modalTitle: document.getElementById("modal-title"),
  closeDeckModalBtn: document.getElementById("close-deck-modal-btn"),
  cancelDeckModalBtn: document.getElementById("cancel-deck-modal-btn"),
  saveDeckBtn: document.getElementById("save-deck-btn"),
  addWordFieldBtn: document.getElementById("add-word-field-btn"),
  deckNameInput: document.getElementById("deck-name"),
  wordInputsContainer: document.getElementById("word-inputs-container"),
  settingVoice: document.getElementById("setting-voice"),
  testUserVoiceBtn: document.getElementById("test-user-voice-btn"),
  searchDeckInput: document.getElementById("search-deck-input"),
  aiSourceType: document.getElementById("ai-source-type"),
  aiTextInputArea: document.getElementById("ai-text-input-area"),
  aiFileInputArea: document.getElementById("ai-file-input-area"),
  aiFileInput: document.getElementById("ai-file-input"),
  quickImportText: document.getElementById("quick-import-text"),
  analyzeWithAiBtn: document.getElementById("analyze-with-ai-btn"),
  wordPreviewContainer: document.getElementById("word-preview-container"),
  aiPreviewTableBody: document.getElementById("ai-preview-table-body"),
  addSelectedWordsBtn: document.getElementById("add-selected-words-btn"),
  wordCountInModal: document.getElementById("word-count-in-modal"),
  selectAllWords: document.getElementById("select-all-words"),
  placeholder: document.getElementById("placeholder"),
  learningContent: document.getElementById("learning-content"),
  flashcard: document.getElementById("flashcard"),
  wordText: document.getElementById("word-text"),
  wordIpa: document.getElementById("word-ipa"),
  meaningText: document.getElementById("meaning-text"),
  exampleBox: document.getElementById("example-box"),
  actionButtons: document.getElementById("action-buttons"),
  learnedBtn: document.getElementById("learned-btn"),
  reviewBtn: document.getElementById("review-btn"),
  flipBackBtn: document.getElementById("flip-back-btn"),
  pronunciationBtn: document.getElementById("pronunciation-btn"),
  prevBtn: document.getElementById("prev-btn"),
  nextBtn: document.getElementById("next-btn"),
  shuffleBtn: document.getElementById("shuffle-btn"),
  resetBtn: document.getElementById("reset-btn"),
  progressCard: document.getElementById("progress-card"),
  wordListCard: document.getElementById("word-list-card"),
  currentWord: document.getElementById("current-word"),
  totalWords: document.getElementById("total-words"),
  currentIndicator: document.getElementById("current-indicator"),
  totalIndicator: document.getElementById("total-indicator"),
  sessionProgress: document.getElementById("session-progress"),
  learnedProgress: document.getElementById("learned-progress"),
  sessionPercentage: document.getElementById("session-percentage"),
  learnedPercentage: document.getElementById("learned-percentage"),
  reviewedCount: document.getElementById("reviewed-count"),
  learnedCount: document.getElementById("learned-count"),
  remainingCount: document.getElementById("remaining-count"),
  wordList: document.getElementById("word-list"),
  wordListBadge: document.getElementById("word-list-badge"),
  progressDots: document.getElementById("progress-dots"),
  completionMessage: document.getElementById("completion-message"),
  userArea: document.querySelector(".user-area"),
  loginRegisterBtn: document.getElementById("open-login-modal-btn"),
  logoutBtn: document.createElement("button"),
  registerModal: document.getElementById("register-modal"),
  closeRegisterModalBtn: document.getElementById("close-register-modal-btn"),
  registerEmailInput: document.getElementById("register-email"),
  registerPasswordInput: document.getElementById("register-password"),
  registerEmailBtn: document.getElementById("register-email-btn"),
  registerFacebookBtn: document.getElementById("register-facebook-btn"),
  openLoginFromRegister: document.getElementById("open-login-from-register"),
  registerMessage: document.getElementById("register-message"),
  loginModal: document.getElementById("login-modal"),
  closeLoginModalBtn: document.getElementById("close-login-modal-btn"),
  loginEmailInput: document.getElementById("login-email"),
  loginPasswordInput: document.getElementById("login-password"),
  loginEmailBtn: document.getElementById("login-email-btn"),
  loginFacebookBtn: document.getElementById("login-facebook-btn"),
  openRegisterFromLogin: document.getElementById("open-register-from-login"),
  loginMessage: document.getElementById("login-message"),
  navLinks: document.querySelectorAll(".navigation .nav-link, .user-area .btn-ghost"),
  dashboardView: document.getElementById("dashboard-view"),
  wordlistView: document.getElementById("wordlist-view"),
  progressView: document.getElementById("progress-view"),
  settingsView: document.getElementById("settings-view"),
  reviewView: document.getElementById("review-view"),
  openChatBtn: document.getElementById("open-chat-btn"),
  chatModal: document.getElementById("chat-modal"),
  closeChatModalBtn: document.getElementById("close-chat-modal-btn"),
  chatInput: document.getElementById("chat-input"),
  sendChatBtn: document.getElementById("send-chat-btn"),
  reviewSetup: document.getElementById("review-setup"),
  reviewDeckSelect: document.getElementById("review-deck-select"),
  startQuizBtn: document.getElementById("start-quiz-btn"),
  startFillBtn: document.getElementById("start-fill-btn"),
  reviewGameContainer: document.getElementById("review-game-container"),
  gameCurrentQ: document.getElementById("game-current-q"),
  gameTotalQ: document.getElementById("game-total-q"),
  gameScore: document.getElementById("game-score"),
  exitReviewBtn: document.getElementById("exit-review-btn"),
  questionText: document.getElementById("question-text"),
  questionHint: document.getElementById("question-hint"),
  quizArea: document.getElementById("quiz-area"),
  quizOptionsContainer: document.getElementById("quiz-options-container"),
  fillArea: document.getElementById("fill-area"),
  fillInput: document.getElementById("fill-input"),
  submitFillBtn: document.getElementById("submit-fill-btn"),
  feedbackSection: document.getElementById("feedback-section"),
  feedbackMessage: document.getElementById("feedback-message"),
  feedbackDetail: document.getElementById("feedback-detail"),
  nextQuestionBtn: document.getElementById("next-question-btn"),
  reviewResultCard: document.getElementById("review-result-card"),
  finalScore: document.getElementById("final-score"),
  finalPercent: document.getElementById("final-percent"),
  reviewAgainBtn: document.getElementById("review-again-btn"),
  backToDashboardBtn: document.getElementById("back-to-dashboard-btn"),
  totalLearnedCount: document.getElementById("total-learned-count"),
  currentStreakVal: document.getElementById("current-streak-val"),
  averageWeeklyWords: document.getElementById("average-weekly-words"),
  totalXpVal: document.getElementById("total-xp-val"),
  activityList: document.getElementById("activity-list"),
  dailyGoalText: document.getElementById("daily-goal-text"),
  dailyGoalProgress: document.getElementById("daily-goal-progress"),
  dailyGoalMessage: document.getElementById("daily-goal-message"),
  leaderboardBody: document.getElementById("leaderboard-body"),
};

elements.logoutBtn.className = "btn btn-outline";
elements.logoutBtn.innerHTML = `
  <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg> Đăng Xuất`;

// =========================================================
// DATA PERSISTENCE
// =========================================================
function saveDataToStorage() {
  const progressToSave = {};
  for (const deckId in progress) {
    if (progress[deckId] && progress[deckId].learnedWords) {
      progressToSave[deckId] = { learnedWords: Array.from(progress[deckId].learnedWords) };
    }
  }
  if (!currentUser) {
    localStorage.setItem("vocabflow_decks", JSON.stringify(decks));
    localStorage.setItem("vocabflow_progress", JSON.stringify(progressToSave));
  }
}

async function loadDataFromStorage() {
  const storedToken = localStorage.getItem("vocabflow_authToken");
  const storedUser = localStorage.getItem("vocabflow_currentUser");
  if (storedToken && storedUser) {
    try {
      const parsedUser = JSON.parse(storedUser);
      parsedUser.token = storedToken;
      // Khôi phục preferred_voice từ localStorage nếu có
      if (!parsedUser.preferred_voice) {
        parsedUser.preferred_voice = parsedUser.preferred_voice || 'en-US-AriaNeural';
      }
      currentUser = parsedUser;
      window.currentUser = currentUser; // expose ra window cho các script khác
      const decksResponse = await fetch(`${BACKEND_API_URL}/decks`, {
        headers: { Authorization: `Bearer ${currentUser.token}` },
      });
      if (decksResponse.ok) {
        const decksData = await decksResponse.json();
        decks = decksData.decks || [];
        const lastActiveId = localStorage.getItem("vocabflow_lastActiveDeck");
        if (lastActiveId && decks.some(d => d.id === lastActiveId)) activeDeckId = lastActiveId;
        else if (decks.length > 0) activeDeckId = decks[0].id;
      } else if (decksResponse.status === 401) {
        handleLogout(true); return;
      }
      // Fetch profile (bao gồm avatar) từ server
      try {
        const meRes = await fetch(`${BACKEND_API_URL}/user/me`, {
          headers: { Authorization: `Bearer ${currentUser.token}` },
        });
        if (meRes.ok) {
          const meData = await meRes.json();
          if (meData.avatar_url) {
            const base = BACKEND_API_URL.replace(/\/api$/, '');
            currentUser.avatar_url = base + meData.avatar_url + '?t=' + Date.now();
          } else {
            currentUser.avatar_url = null;
          }
          // Load preferred_voice + theme ngay khi boot — fix giọng đọc
          if (meData.preferred_voice) currentUser.preferred_voice = meData.preferred_voice;
          if (meData.theme) applyTheme(meData.theme);
          window.currentUser = currentUser;
          if (typeof window.loadAvatar === 'function') {
            window.loadAvatar(currentUser.username || '');
          }
        }
      } catch(e) { /* bỏ qua nếu lỗi mạng */ }
      const progRes = await fetch(`${BACKEND_API_URL}/progress`, {
        headers: { Authorization: `Bearer ${currentUser.token}` },
      });
      if (progRes.ok) {
        const progData = await progRes.json();
        progress = {};
        for (const dId in progData.progress) {
          progress[dId] = { learnedWords: new Set(progData.progress[dId].learnedWords) };
        }
      }
    } catch (e) { console.warn("⚠️ Lỗi kết nối API.", e); }
  }
  if (decks.length === 0) {
    const localDecks = localStorage.getItem("vocabflow_decks");
    decks = localDecks ? JSON.parse(localDecks) : [...defaultDecks];
    if (decks.length > 0 && !activeDeckId) activeDeckId = decks[0].id;
  }
}

async function handleShareDeck(deckId) {
  if (!currentUser) { alert("Vui lòng đăng nhập để chia sẻ bộ từ."); return; }
  if (!confirm("Bạn có chắc chắn muốn gửi yêu cầu chia sẻ bộ từ này lên Thư viện Cộng đồng?")) return;
  try {
    const response = await fetch(`${BACKEND_API_URL}/decks/submit/${deckId}`, {
      method: "POST", headers: { Authorization: `Bearer ${currentUser.token}` }
    });
    const data = await response.json();
    alert(response.ok ? data.msg : "Lỗi: " + data.msg);
  } catch { alert("Không thể kết nối đến server."); }
}

// =========================================================
// INITIALIZATION
// =========================================================
async function init() {
  setupEventListeners();
  try { await loadDataFromStorage(); } catch (e) { console.error("❌ Lỗi tải dữ liệu:", e); }
  if (currentUser) setupSettings();
  updateAuthUI();
  renderDeckList();
  updateActiveDeckLabel();

  // ── Detect group_study mode ──────────────────────────
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mode') === 'group_study') {
    try {
      const raw = sessionStorage.getItem('study_group_deck');
      const gid = sessionStorage.getItem('study_group_id');
      if (raw && gid) {
        groupStudyDeck = JSON.parse(raw);
        groupStudyGroupId = gid;
        groupStudyMode = true;
        sessionStorage.removeItem('study_group_deck');
        sessionStorage.removeItem('study_group_id');
        // Xóa ?mode=group_study khỏi URL không reload
        window.history.replaceState({}, '', window.location.pathname);
        const tempDeck = {
          id: groupStudyDeck.id,
          name: groupStudyDeck.name,
          words: (groupStudyDeck.words || []).map((w, i) => ({
            id: w.id || `gw-${i}`,
            word: w.word, ipa: w.ipa || '', meaning: w.meaning,
            example: { en: w.example_en || '', vi: w.example_vi || '' }
          })),
          _isGroupDeck: true,
          _groupId: groupStudyDeck.group_id,
          _groupName: groupStudyDeck.group_name
        };
        activeGroupDeck = tempDeck;
        // Không inject vào decks[]
        currentIndex = 0;
        const label = document.getElementById('active-deck-label');
        const icon  = document.getElementById('active-deck-icon');
        if (label) label.textContent = groupStudyDeck.name;
        if (icon)  icon.textContent  = '🏫';
        renderDeckList();
        switchView('dashboard');
        updateDisplay();
        return;
      }
    } catch(e) { console.error('group_study parse error', e); }
  }
  // ── End group_study ──────────────────────────────────

  // Không override nếu user đã chủ động chọn tab trong khi init đang chạy
  if (!_viewSetByUser) {
    switchView(currentView);
  }
  _initDone = true;
  _viewSetByUser = false; // reset cho lần sau
  if ((groupStudyMode && activeGroupDeck) || (activeDeckId && decks.length > 0)) updateDisplay();
  else if (!_viewSetByUser) showPlaceholder();
}

// =========================================================
// AUTH UI
// =========================================================
function updateAuthUI() {
  if (!elements.userArea) return;
  const oldLogout = document.getElementById("logout-btn");
  if (oldLogout) oldLogout.remove();
  if (currentUser && currentUser.token) {
    if (elements.loginRegisterBtn) elements.loginRegisterBtn.classList.add("hidden");
    // KHÔNG thêm logout vào header — chỉ có ở Settings
    const rawName = currentUser.username || "Học viên";
    const displayName = rawName.includes('@') ? rawName.split('@')[0] : rawName;
    if (elements.loginRegisterBtn) {
      elements.loginRegisterBtn.textContent = `Chào, ${displayName}`;
      elements.loginRegisterBtn.classList.remove("hidden");
      elements.loginRegisterBtn.disabled = true;
    }
    if (elements.openChatBtn) elements.openChatBtn.classList.remove("hidden");
    // Hiện notification bell + khởi động polling
    const bellWrap = document.getElementById('notif-bell-wrap');
    if (bellWrap) { bellWrap.classList.remove('hidden'); initNotifications(); }
    if (currentView === "dashboard") {
      if (activeDeckId && decks.length > 0) showLearningContent();
      else showPlaceholder(decks.length === 0);
    }
  } else {
    if (elements.loginRegisterBtn) {
      elements.loginRegisterBtn.classList.remove("hidden");
      elements.loginRegisterBtn.textContent = "Đăng Nhập";
      elements.loginRegisterBtn.disabled = false;
      elements.loginRegisterBtn.onclick = openLoginModal;
    }
    if (elements.openChatBtn) elements.openChatBtn.classList.add("hidden");
    // Ẩn notification bell khi đăng xuất
    const bellWrap = document.getElementById('notif-bell-wrap');
    if (bellWrap) bellWrap.classList.add('hidden');
    const panel = document.getElementById('notif-panel');
    if (panel) { panel.style.display = 'none'; panel.classList.remove('hidden'); }
    if (_notifPollInterval) { clearInterval(_notifPollInterval); _notifPollInterval = null; }
    if (window._notifOutsideHandler) {
      document.removeEventListener('click', window._notifOutsideHandler);
      window._notifOutsideHandler = null;
    }
    if (panel) panel.classList.add('hidden');
    if (elements.progressCard) elements.progressCard.style.display = 'none';
    if (elements.wordListCard) elements.wordListCard.style.display = 'none';
    if (currentView === "dashboard") showPlaceholder(false);
  }
}

// =========================================================
// DECK RENDERING
// =========================================================
function renderDeckList(filteredDecks = null) {
  // Expose ra window cho Pronunciation module
  window.__decks_ref        = decks;
  window.__activeDeckId_ref = activeDeckId;
  if (!elements.deckList) return;
  elements.deckList.innerHTML = "";
  const listToRender = filteredDecks || decks;
  if (listToRender.length === 0) {
    elements.deckList.innerHTML = '<p style="text-align:center;color:#94a3b8;font-size:0.8rem;padding:10px">Không tìm thấy kết quả.</p>';
    return;
  }
  listToRender.forEach((deck) => {
    const item = document.createElement("div");
    item.className = "deck-item" + (deck.id === activeDeckId ? " active" : "");
    item.innerHTML = `
      <span title="${deck.name}">${deck.name}</span>
      <div class="deck-item-actions">
        <button class="deck-action-btn share-btn" title="Chia sẻ"><i class="fa-solid fa-share-nodes"></i></button>
        <button class="deck-action-btn edit-btn"><i class="fa-solid fa-pen"></i></button>
        <button class="deck-action-btn delete-btn"><i class="fa-solid fa-trash"></i></button>
      </div>`;
    item.addEventListener("click", () => handleSelectDeck(deck.id));
    item.querySelector(".share-btn").onclick = (e) => { e.stopPropagation(); handleShareDeck(deck.id); };
    item.querySelector(".edit-btn").onclick = (e) => { e.stopPropagation(); handleEditDeck(deck.id); };
    item.querySelector(".delete-btn").onclick = (e) => { e.stopPropagation(); handleDeleteDeck(deck.id); };
    elements.deckList.appendChild(item);
  });
}

function updateDisplay() {
  // Nếu đang học bộ từ nhóm thì dùng activeGroupDeck, không dùng decks[]
  const activeDeck = groupStudyMode && activeGroupDeck
    ? activeGroupDeck
    : decks.find((d) => d.id === activeDeckId);
  if (!activeDeck || activeDeck.words.length === 0) { showPlaceholder(true); return; }
  showLearningContent();
  const word = activeDeck.words[currentIndex];
  const deckProgress = progress[activeDeck.id] || { learnedWords: new Set() };
  const total = activeDeck.words.length, learned = deckProgress.learnedWords.size;

  // Đổi màu flashcard theo index từ — mỗi từ 1 màu, lặp 0–9
  if (elements.flashcard) {
    elements.flashcard.setAttribute('data-color-index', currentIndex % 10);
  }

  elements.wordText.textContent = word.word;
  elements.wordIpa.textContent = word.ipa || "";
  elements.meaningText.textContent = word.meaning;
  elements.exampleBox.innerHTML = `
    <p class="example-text example-en" lang="en">"${word.example?.en || ""}"</p>
    <p class="example-text example-vi" lang="vi">"${word.example?.vi || ""}"</p>`;
  const sessionPerc = total > 0 ? Math.round(((currentIndex + 1) / total) * 100) : 0;
  const learnedPerc = total > 0 ? Math.round((learned / total) * 100) : 0;
  elements.sessionProgress.style.width = `${sessionPerc}%`;
  elements.learnedProgress.style.width = `${learnedPerc}%`;
  elements.sessionPercentage.textContent = `${sessionPerc}%`;
  elements.learnedPercentage.textContent = `${learnedPerc}%`;
  elements.currentWord.textContent = currentIndex + 1;
  elements.totalWords.textContent = total;
  elements.currentIndicator.textContent = currentIndex + 1;
  elements.totalIndicator.textContent = total;
  elements.reviewedCount.textContent = currentIndex + 1;
  elements.learnedCount.textContent = learned;
  elements.remainingCount.textContent = total - learned;
  elements.wordListBadge.textContent = `${total} từ`;
  elements.prevBtn.disabled = currentIndex === 0;
  elements.nextBtn.disabled = currentIndex === total - 1;
  elements.completionMessage.classList.toggle("show", learned === total && total > 0);
  renderWordList();
  renderProgressDots();
}

function renderWordList() {
  const activeDeck = (groupStudyMode && activeGroupDeck)
    ? activeGroupDeck
    : decks.find((d) => d.id === activeDeckId);
  if (!activeDeck) { elements.wordList.innerHTML = ''; elements.wordListBadge.textContent = "0 từ"; return; }
  const deckId = activeDeck.id;
  const deckProgress = progress[deckId] || { learnedWords: new Set() };
  elements.wordList.innerHTML = "";
  activeDeck.words.forEach((word, index) => {
    const item = document.createElement("div");
    item.className = "word-item";
    let status = "pending";
    if (deckProgress.learnedWords.has(word.id)) status = "learned";
    else if (index === currentIndex) status = "current";
    else if (index < currentIndex) status = "reviewed";
    item.classList.add(status);
    let iconHtml = status === "learned"
      ? `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>`
      : status === "current"
      ? `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg>`
      : `<div style="width:1rem;height:1rem;border-radius:50%;border:2px solid rgba(0,0,0,0.15)"></div>`;
    item.innerHTML = `
      <div class="word-status-icon">${iconHtml}</div>
      <div class="word-content">
        <p class="word-title" lang="en">${word.word}</p>
        <p class="word-meaning" lang="vi">${word.meaning}</p>
      </div>
      <span class="word-number">${index + 1}</span>`;
    item.addEventListener("click", () => { currentIndex = index; if (isFlipped) flipCard(); updateDisplay(); });
    elements.wordList.appendChild(item);
  });
}

function renderProgressDots() {
  const activeDeck = (groupStudyMode && activeGroupDeck)
    ? activeGroupDeck
    : decks.find((d) => d.id === activeDeckId);
  if (!activeDeck) { elements.progressDots.innerHTML = ""; return; }
  const deckProgress = progress[activeDeck.id] || { learnedWords: new Set() };
  elements.progressDots.innerHTML = "";
  activeDeck.words.forEach((word, index) => {
    const dot = document.createElement("div");
    dot.className = "progress-dot";
    if (index === currentIndex) dot.classList.add("current");
    else if (deckProgress.learnedWords.has(word.id)) dot.classList.add("completed");
    dot.addEventListener("click", () => { currentIndex = index; if (isFlipped) flipCard(); updateDisplay(); });
    elements.progressDots.appendChild(dot);
  });
}

function showPlaceholder(isDeckEmpty = false) {
  elements.learningContent.classList.remove("visible");
  elements.placeholder.classList.remove("hidden");
  elements.progressCard.style.display = "none";
  elements.wordListCard.style.display = "none";
  elements.placeholder.innerHTML = isDeckEmpty
    ? `<h2>Bộ từ này trống.</h2><p>Vui lòng chỉnh sửa để thêm từ.</p>`
    : `<h2>Chào mừng đến với VocabFlow!</h2><p>Chọn một bộ từ để bắt đầu học, hoặc tạo một bộ từ mới.</p>`;
}

function showLearningContent() {
  elements.learningContent.classList.add("visible");
  elements.placeholder.classList.add("hidden");
  elements.progressCard.style.display = "block";
  elements.wordListCard.style.display = "block";
}

// =========================================================
// NAVIGATION
// =========================================================
function switchView(targetViewId) {
  if (reviewTimerInterval) clearInterval(reviewTimerInterval);
  // "group" là external page — không xử lý, fallback về dashboard
  if (targetViewId === "group") targetViewId = "dashboard";
  document.querySelectorAll(".main-grid, .page-view").forEach((v) => v.classList.add("hidden"));
  const targetElement = document.getElementById(targetViewId + "-view");
  if (targetViewId === "dashboard") elements.dashboardView.classList.remove("hidden");
  else if (targetElement) targetElement.classList.remove("hidden");
  else { elements.dashboardView.classList.remove("hidden"); targetViewId = "dashboard"; }
  currentView = targetViewId;
  try { if (targetViewId !== "group") sessionStorage.setItem('vocabflow_view', targetViewId); } catch {}
  elements.navLinks.forEach((link) => {
    link.classList.remove("active");
    if (link.getAttribute("data-view-target") === targetViewId) link.classList.add("active");
  });
  // Sync mobile bottom nav active state
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('data-view-target') === targetViewId) item.classList.add('active');
  });
  if (currentView !== "dashboard") {
    elements.progressCard.style.display = "none";
    elements.wordListCard.style.display = "none";
  } else if (activeDeckId) {
    elements.progressCard.style.display = "block";
    elements.wordListCard.style.display = "block";
  }
  if (targetViewId === "wordlist") loadLibrary();
  if (targetViewId === "group") {
    // Init group module khi chuyển sang tab nhóm
    setTimeout(() => {
      if (typeof window.initGroupView === 'function') window.initGroupView();
    }, 50);
  }
  if (targetViewId === "review") {
    resetReviewState();
    elements.reviewSetup.classList.remove("hidden");
    elements.reviewGameContainer.classList.add("hidden");
    elements.reviewResultCard.classList.add("hidden");
    populateReviewDeckSelect();
  }
  if (targetViewId === "progress") loadProgressViewData();
  if (targetViewId === "settings") setupSettings();
  if (targetViewId === "admin") { window.open("/admin", "_blank"); return; }
}

// =========================================================
// EVENT LISTENERS
// =========================================================
function setupEventListeners() {
  // ── Mobile bottom nav bar ─────────────────────────────────
  const mobileNavBar = document.getElementById('mobile-nav-bar');
  const mq = window.matchMedia('(max-width: 480px)');
  function toggleMobileNav(e) {
    if (mobileNavBar) mobileNavBar.style.display = e.matches ? 'flex' : 'none';
  }
  mq.addEventListener('change', toggleMobileNav);
  toggleMobileNav(mq);

  // Mobile nav items click — reuse same data-view-target logic
  document.querySelectorAll('.mobile-nav-item[data-view-target]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      _viewSetByUser = true;
      switchView(item.getAttribute('data-view-target'));
    });
  });
  // ──────────────────────────────────────────────────────────

  // Click ngoài modal để đóng
  ['deck-modal','login-modal','register-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e) => {
      if (e.target === el) {
        if (id === 'deck-modal') handleCloseDeckModal();
        else if (id === 'login-modal') closeLoginModal();
        else if (id === 'register-modal') closeRegisterModal();
      }
    });
  });
  if (elements.chatModal) elements.chatModal.addEventListener('click', (e) => {
    if (e.target === elements.chatModal) closeChatModal();
  });

  if (elements.createDeckBtn) elements.createDeckBtn.addEventListener("click", handleOpenDeckModal);
  if (elements.closeDeckModalBtn) elements.closeDeckModalBtn.addEventListener("click", handleCloseDeckModal);
  if (elements.cancelDeckModalBtn) elements.cancelDeckModalBtn.addEventListener("click", handleCloseDeckModal);
  if (elements.saveDeckBtn) elements.saveDeckBtn.addEventListener("click", handleSaveDeck);
  if (elements.addWordFieldBtn) elements.addWordFieldBtn.addEventListener("click", () => addWordInputField());
  if (elements.searchDeckInput) {
    elements.searchDeckInput.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase().trim();
      renderDeckList(decks.filter(d => d.name.toLowerCase().includes(term)));
    });
  }
  if (elements.analyzeWithAiBtn) elements.analyzeWithAiBtn.addEventListener("click", handleAnalyzeWithAi);
  if (elements.aiSourceType) elements.aiSourceType.addEventListener("change", handleAiSourceChange);
  if (elements.aiFileInput) {
    elements.aiFileInput.addEventListener("change", (e) => {
      const display = document.getElementById("file-name-display");
      if (!display) return;
      const files = e.target.files;
      if (!files || files.length === 0) display.textContent = "Chọn file (có thể chọn nhiều)";
      else if (files.length === 1) display.textContent = files[0].name;
      else display.textContent = `${files.length} file đã chọn (${Array.from(files).map(f=>f.name.split('.').pop().toUpperCase()).join(', ')})`;
    });
  }
  if (elements.flashcard) {
    elements.flashcard.addEventListener("click", (e) => {
      if (!e.target.closest(".pronunciation-btn") && !e.target.closest(".action-buttons") && !e.target.closest(".navigation-controls")) flipCard();
    });
  }
  if (elements.pronunciationBtn) {
    elements.pronunciationBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); handlePronunciation(); });
  }
  if (elements.learnedBtn) elements.learnedBtn.addEventListener("click", (e) => { e.preventDefault(); handleMarkWord("learned"); });
  if (elements.reviewBtn) elements.reviewBtn.addEventListener("click", (e) => { e.preventDefault(); handleMarkWord("review"); });
  if (elements.flipBackBtn) elements.flipBackBtn.addEventListener("click", (e) => { e.preventDefault(); flipCard(); });
  if (elements.prevBtn) elements.prevBtn.addEventListener("click", (e) => { e.preventDefault(); handlePrevious(); });
  if (elements.nextBtn) elements.nextBtn.addEventListener("click", (e) => { e.preventDefault(); handleNext(); });
  if (elements.shuffleBtn) elements.shuffleBtn.addEventListener("click", (e) => { e.preventDefault(); handleShuffle(); });
  if (elements.resetBtn) elements.resetBtn.addEventListener("click", (e) => { e.preventDefault(); handleReset(); });
  document.addEventListener("keydown", handleKeyPress);

  // Auth
  if (elements.loginRegisterBtn) elements.loginRegisterBtn.addEventListener("click", openLoginModal);
  if (elements.closeRegisterModalBtn) elements.closeRegisterModalBtn.addEventListener("click", closeRegisterModal);
  if (elements.closeLoginModalBtn) elements.closeLoginModalBtn.addEventListener("click", closeLoginModal);
  if (elements.registerEmailBtn) elements.registerEmailBtn.addEventListener("click", handleRegisterEmail);
  if (elements.loginEmailBtn) elements.loginEmailBtn.addEventListener("click", handleLoginEmail);
  if (elements.registerFacebookBtn) elements.registerFacebookBtn.addEventListener("click", handleRegisterFacebook);
  if (elements.loginFacebookBtn) elements.loginFacebookBtn.addEventListener("click", handleLoginFacebook);
  if (elements.openLoginFromRegister) elements.openLoginFromRegister.addEventListener("click", (e) => { e.preventDefault(); closeRegisterModal(); openLoginModal(); });
  if (elements.openRegisterFromLogin) elements.openRegisterFromLogin.addEventListener("click", (e) => { e.preventDefault(); closeLoginModal(); openRegisterModal(); });

  // Nav links
  elements.navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const target = link.getAttribute("data-view-target");
      if (target) {
        e.preventDefault();
        _viewSetByUser = true;
        switchView(target);
      }
    });
  });

  // Chat FAB
  if (elements.openChatBtn) elements.openChatBtn.addEventListener("click", openChatModal);

  // Review
  if (elements.startQuizBtn) elements.startQuizBtn.addEventListener("click", () => handleStartReview("quiz"));
  if (elements.startFillBtn) elements.startFillBtn.addEventListener("click", () => handleStartReview("fill"));
  document.getElementById("start-en-vi-btn")?.addEventListener("click", () => handleStartReview("en-vi"));
  if (elements.exitReviewBtn) elements.exitReviewBtn.addEventListener("click", () => switchView("review"));
  if (elements.nextQuestionBtn) elements.nextQuestionBtn.addEventListener("click", () => { loadNextQuestion(); });

  // Luyện Phát Âm AI
  document.getElementById('start-pronun-btn')?.addEventListener('click', () => {
    const deckId = document.getElementById('review-deck-select')?.value;
    let words = [];
    if (deckId === 'all') {
      decks.forEach(d => words.push(...(d.words || [])));
    } else {
      const deck = decks.find(d => d.id === deckId);
      words = deck ? (deck.words || []) : [];
    }
    const count = parseInt(document.getElementById('review-count-select')?.value) || words.length;
    words = words.sort(() => Math.random() - 0.5).slice(0, isNaN(count) ? words.length : count);
    if (typeof window.startPronunciationMode === 'function') {
      window.startPronunciationMode(words);
    }
  });
  if (elements.submitFillBtn) elements.submitFillBtn.addEventListener("click", handleFillAnswer);
  if (elements.fillInput) elements.fillInput.addEventListener("keypress", (e) => { if (e.key === "Enter") { e.preventDefault(); handleFillAnswer(); } });
  if (elements.reviewAgainBtn) elements.reviewAgainBtn.addEventListener("click", () => switchView("review"));
  if (elements.backToDashboardBtn) elements.backToDashboardBtn.addEventListener("click", () => switchView("dashboard"));

  // Settings logout
  const logoutSettingsBtn = document.getElementById("logout-settings-btn");
  if (logoutSettingsBtn) logoutSettingsBtn.addEventListener("click", () => handleLogout(false));
}

// =========================================================
// DECK MANAGEMENT
// =========================================================
function handleSelectDeck(deckId) {
  if (activeDeckId === deckId) return;
  activeDeckId = deckId;
  localStorage.setItem("vocabflow_lastActiveDeck", deckId);
  currentIndex = 0; isFlipped = false;
  if (elements.flashcard) elements.flashcard.classList.remove("flipped");
  const selectedDeck = decks.find(d => d.id === deckId);
  // Chuyển sang deck cá nhân → thoát group study mode
  groupStudyMode = false; groupStudyDeck = null; groupStudyGroupId = null; activeGroupDeck = null;
  // Đóng dropdown khi chọn deck
  deckPanelOpen = false;
  const panel   = document.getElementById('deck-dropdown-panel');
  const chevron = document.getElementById('deck-panel-chevron');
  if (panel)   panel.style.display    = 'none';
  if (chevron) chevron.style.transform = '';
  updateActiveDeckLabel();
  renderDeckList();
  updateDisplay();
}

function openModal(id)  { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden');    document.body.style.overflow = '';       }

function handleOpenDeckModal() {
  editingDeckId = null; aiPreviewWords = [];
  elements.wordPreviewContainer.classList.add("hidden");
  elements.wordCountInModal.textContent = "0 từ";
  elements.modalTitle.textContent = "Tạo Bộ Từ Mới";
  elements.deckNameInput.value = "";
  elements.wordInputsContainer.innerHTML = "";
  elements.quickImportText.value = "";
  addWordInputField(); addWordInputField(); addWordInputField();
  handleAiSourceChange();
  elements.deckModal.classList.remove("hidden");
}

function handleEditDeck(deckId) {
  editingDeckId = deckId; aiPreviewWords = [];
  elements.wordPreviewContainer.classList.add("hidden");
  const deck = decks.find((d) => d.id === deckId);
  if (!deck) return;
  elements.modalTitle.textContent = "Sửa Bộ Từ";
  elements.deckNameInput.value = deck.name;
  elements.wordInputsContainer.innerHTML = "";
  elements.quickImportText.value = "";
  elements.wordCountInModal.textContent = `${(deck.words || []).length} từ`;
  (deck.words || []).forEach((word) => addWordInputField(word));
  addWordInputField();
  handleAiSourceChange();
  elements.deckModal.classList.remove("hidden");
}

async function handleDeleteDeck(deckId) {
  if (!confirm("Bạn có chắc chắn muốn xóa bộ từ này không?")) return;
  if (currentUser) {
    try {
      const response = await fetch(`${BACKEND_API_URL}/decks/${deckId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${currentUser.token}` },
      });
      const data = await response.json();
      if (response.ok) {
        await loadDataFromStorage();
        if (activeDeckId === deckId) { activeDeckId = decks.length > 0 ? decks[0].id : null; localStorage.removeItem("vocabflow_lastActiveDeck"); }
        renderDeckList(); updateDisplay();
      } else alert(`Lỗi khi xóa bộ từ: ${data.msg || "Không xác định"}`);
    } catch { alert("Không thể kết nối đến server để xóa bộ từ."); }
  } else {
    decks = decks.filter((d) => d.id !== deckId);
    if (progress[deckId]) delete progress[deckId];
    saveDataToStorage();
    if (activeDeckId === deckId) { activeDeckId = decks.length > 0 ? decks[0].id : null; }
    renderDeckList(); updateDisplay();
  }
}

function handleCloseDeckModal() { elements.deckModal.classList.add("hidden"); document.body.style.overflow = ""; }

function addWordInputField(word = { word: "", ipa: "", meaning: "", example: { en: "", vi: "" } }) {
  const group = document.createElement("div");
  group.className = "word-input-group";
  const wordId = word.id || `word-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  group.innerHTML = `
    <input type="hidden" class="word-id-input" value="${wordId}">
    <div class="word-input-field">
      <label>Từ</label><input type="text" placeholder="Từ tiếng Anh" class="word-input" value="${word.word}" lang="en">
      <label>Phiên âm IPA</label><input type="text" placeholder="/fəˈnɛtɪk/" class="ipa-input" value="${word.ipa || ""}" lang="en">
    </div>
    <div class="word-input-field">
      <label>Nghĩa</label><input type="text" placeholder="Nghĩa của từ" class="meaning-input" value="${word.meaning}" lang="vi">
    </div>
    <div class="word-input-field">
      <label>Ví dụ (Anh)</label><input type="text" placeholder="Câu ví dụ tiếng Anh" class="example-en-input" value="${word.example?.en || ""}" lang="en">
      <label>Ví dụ (Việt)</label><input type="text" placeholder="Bản dịch tiếng Việt" class="example-vi-input" value="${word.example?.vi || ""}" lang="vi">
    </div>
    <button class="remove-word-btn" title="Xóa Từ">&times;</button>`;
  group.querySelector(".remove-word-btn").addEventListener("click", () => {
    group.remove();
    elements.wordCountInModal.textContent = `${elements.wordInputsContainer.children.length} từ`;
  });
  elements.wordInputsContainer.appendChild(group);
  elements.wordCountInModal.textContent = `${elements.wordInputsContainer.children.length} từ`;
}

function handleAiSourceChange() {
  const sourceType = elements.aiSourceType ? elements.aiSourceType.value : "text";
  const fileWarning = document.getElementById("file-warning-message");
  if (elements.aiTextInputArea) elements.aiTextInputArea.classList.toggle("hidden", sourceType !== "text");
  if (elements.aiFileInputArea) elements.aiFileInputArea.classList.toggle("hidden", sourceType !== "file");
  if (elements.wordPreviewContainer) elements.wordPreviewContainer.classList.add("hidden");
  if (fileWarning) fileWarning.classList.toggle("hidden", sourceType !== "file");
  aiPreviewWords = [];
}

async function handleAnalyzeWithAi() {
  if (!currentUser) { alert("Vui lòng đăng nhập để sử dụng tính năng AI."); return; }
  const sourceType = document.getElementById("ai-source-type").value;
  let payload = null;
  const headers = { Authorization: `Bearer ${currentUser.token}` };

  if (sourceType === "file") {
    const files = elements.aiFileInput.files;
    if (!files || files.length === 0) { alert("Vui lòng chọn ít nhất một file."); return; }
    // Kiểm tra kích thước từng file
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) { alert(`File "${f.name}" quá lớn (>10MB).`); return; }
    }
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append("file", f));
    payload = formData;
  } else {
    const text = elements.quickImportText.value.trim();
    if (!text || text.length < 10) { alert("Vui lòng dán đoạn văn bản tiếng Anh (ít nhất 10 ký tự)."); return; }
    payload = JSON.stringify({ text });
    headers["Content-Type"] = "application/json";
  }

  const btn = elements.analyzeWithAiBtn;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span style="display:flex;align-items:center;gap:6px">
    <svg style="width:14px;height:14px;animation:spin .7s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
    AI đang phân tích...
  </span>`;

  try {
    const response = await fetch(`${BACKEND_API_URL}/ai/analyze_text`, { method: "POST", headers, body: payload });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.msg || `Lỗi server (${response.status})`);
    }

    // Hiện warning nếu có file không đọc được
    if (data.warning) {
      console.warn("AI warning:", data.warning);
    }

    const newWords = data.word_list;
    if (!Array.isArray(newWords) || newWords.length === 0) {
      alert("AI không tìm thấy từ vựng nào. Thử dùng văn bản tiếng Anh rõ ràng hơn.");
      return;
    }

    // Render preview table
    const previewContainer = document.getElementById("word-preview-container");
    const previewBody     = document.getElementById("ai-preview-table-body");
    previewBody.innerHTML = "";
    let localWords = newWords.map(w => ({
      ...w, selected: true,
      id: `word-${Date.now()}-${Math.random().toString(36).slice(2,9)}`
    }));

    localWords.forEach((word, idx) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><input type="checkbox" class="word-select-cb" checked data-idx="${idx}"></td>
        <td><strong>${esc(word.word)}</strong></td>
        <td><code style="color:hsl(var(--primary));font-size:0.8rem">${esc(word.ipa||"")}</code></td>
        <td style="font-size:0.85rem">${esc(word.meaning)}</td>
        <td style="font-size:0.78rem;color:hsl(var(--muted-foreground))">${esc(word.example_en||"")}</td>`;
      previewBody.appendChild(row);
    });

    const selectAllCb = document.getElementById("select-all-words");
    previewBody.querySelectorAll(".word-select-cb").forEach(cb => {
      cb.addEventListener("change", e => {
        localWords[+e.target.dataset.idx].selected = e.target.checked;
        if (selectAllCb) selectAllCb.checked = localWords.every(w => w.selected);
      });
    });
    if (selectAllCb) {
      selectAllCb.checked = true;
      selectAllCb.onchange = e => {
        previewBody.querySelectorAll(".word-select-cb").forEach(cb => cb.checked = e.target.checked);
        localWords.forEach(w => w.selected = e.target.checked);
      };
    }

    document.getElementById("add-selected-words-btn").onclick = () => {
      const selected = localWords.filter(w => w.selected);
      if (!selected.length) { alert("Chọn ít nhất 1 từ."); return; }
      selected.forEach(w => addWordInputField({
        id: w.id, word: w.word, ipa: w.ipa || "",
        meaning: w.meaning,
        example: { en: w.example_en || "", vi: w.example_vi || "" },
      }));
      previewContainer.classList.add("hidden");
      elements.quickImportText.value = "";
      if (elements.aiFileInput) elements.aiFileInput.value = "";
      document.getElementById("file-name-display").textContent = "Chọn file (có thể chọn nhiều)";
    };

    previewContainer.classList.remove("hidden");
    if (elements.wordCountInModal) elements.wordCountInModal.textContent = `Tìm thấy ${newWords.length} từ`;
    // Scroll xuống preview
    previewContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (data.warning) alert(`⚠️ ${data.warning}

Đã trích xuất ${newWords.length} từ từ các file còn lại.`);

  } catch (err) {
    // Hiện lỗi rõ ràng
    const msg = err.message || "Lỗi không xác định";
    alert(`❌ Phân tích thất bại:
${msg}`);
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}

// =========================================================
// FLASHCARD LOGIC
// =========================================================
function flipCard() {
  isFlipped = !isFlipped;
  elements.flashcard.classList.toggle("flipped", isFlipped);
  elements.actionButtons.classList.toggle("show", isFlipped);
  elements.flipBackBtn.classList.toggle("show", isFlipped);
}

let globalFlashcardAudio = null;
function handlePronunciation() {
  const activeDeck = (groupStudyMode && activeGroupDeck)
    ? activeGroupDeck
    : decks.find((d) => d.id === activeDeckId);
  if (!activeDeck || !activeDeck.words || activeDeck.words.length === 0) return;
  const word = activeDeck.words[currentIndex];
  if (!word || !word.word) return;
  if (globalFlashcardAudio) { globalFlashcardAudio.pause(); globalFlashcardAudio.src = ""; globalFlashcardAudio.load(); globalFlashcardAudio = null; }
  try {
    const voiceId = (currentUser && currentUser.preferred_voice) ? currentUser.preferred_voice : "en-US-AriaNeural";
    globalFlashcardAudio = new Audio(`${BACKEND_API_URL}/audio?text=${encodeURIComponent(word.word)}&voice=${voiceId}`);
    if (elements.pronunciationBtn) elements.pronunciationBtn.style.opacity = "0.4";
    globalFlashcardAudio.play()
      .then(() => {
        globalFlashcardAudio.onended = () => {
          if (elements.pronunciationBtn) elements.pronunciationBtn.style.opacity = "1";
          globalFlashcardAudio = null;
        };
      })
      .catch(() => { if (elements.pronunciationBtn) elements.pronunciationBtn.style.opacity = "1"; });
    globalFlashcardAudio.onerror = () => { if (elements.pronunciationBtn) elements.pronunciationBtn.style.opacity = "1"; };
  } catch (e) { console.error("Lỗi phát âm:", e); }
}

async function handleMarkWord(status) {
  // Lấy deck đang active — nhóm hoặc cá nhân
  const activeDeck = (groupStudyMode && activeGroupDeck)
    ? activeGroupDeck
    : decks.find((d) => d.id === activeDeckId);
  if (!activeDeck || !activeDeck.words || activeDeck.words.length === 0) return;
  const deckId = activeDeck.id;
  const currentWord = activeDeck.words[currentIndex];
  if (!currentWord) return;
  if (!progress[deckId]) progress[deckId] = { learnedWords: new Set() };
  if (status === "learned") progress[deckId].learnedWords.add(currentWord.id);
  else if (status === "review") progress[deckId].learnedWords.delete(currentWord.id);
  if (currentUser) {
    try {
      if (!groupStudyMode) {
        // Bộ từ cá nhân
        const response = await fetch(`${BACKEND_API_URL}/progress/${deckId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentUser.token}` },
          body: JSON.stringify({ word_id: currentWord.id, status }),
        });
        if (response.ok && status === "learned") { trackStudyActivity(); loadProgressViewData(); }
      } else if (groupStudyGroupId && groupStudyDeck) {
        // Bộ từ nhóm — lưu progress nhóm
        await fetch(`${BACKEND_API_URL}/groups/${groupStudyGroupId}/progress/${groupStudyDeck.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentUser.token}` },
          body: JSON.stringify({ word_id: currentWord.id, status }),
        });
      }
    } catch { console.error("Error updating progress"); }
  }
  saveDataToStorage(); updateDisplay(); handleNext();
}

function _getActiveDeck() {
  return (groupStudyMode && activeGroupDeck)
    ? activeGroupDeck
    : decks.find((d) => d.id === activeDeckId);
}

function handleNext() {
  const activeDeck = _getActiveDeck();
  if (!activeDeck || activeDeck.words.length === 0) return;
  if (currentIndex < activeDeck.words.length - 1) currentIndex++;
  if (isFlipped) flipCard();
  updateDisplay();
}

function handlePrevious() {
  const activeDeck = _getActiveDeck();
  if (!activeDeck || activeDeck.words.length === 0) return;
  if (currentIndex > 0) currentIndex--;
  if (isFlipped) flipCard();
  updateDisplay();
}

function handleShuffle() {
  const activeDeck = _getActiveDeck();
  if (!activeDeck || activeDeck.words.length === 0) return;
  for (let i = activeDeck.words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [activeDeck.words[i], activeDeck.words[j]] = [activeDeck.words[j], activeDeck.words[i]];
  }
  currentIndex = 0; isFlipped = false;
  elements.flashcard.classList.remove("flipped");
  elements.actionButtons.classList.remove("show");
  saveDataToStorage(); updateDisplay();
}

function handleReset() {
  if (!confirm("Đặt lại toàn bộ tiến độ cho bộ từ này?")) return;
  const activeDeck = _getActiveDeck();
  if (activeDeck && progress[activeDeck.id]) progress[activeDeck.id].learnedWords.clear();
  currentIndex = 0; isFlipped = false;
  elements.flashcard.classList.remove("flipped");
  elements.actionButtons.classList.remove("show");
  saveDataToStorage(); updateDisplay();
}

function handleKeyPress(e) {
  const modalsOpen = !elements.deckModal.classList.contains("hidden") ||
    !elements.loginModal.classList.contains("hidden") ||
    !elements.registerModal.classList.contains("hidden") ||
    !elements.chatModal.classList.contains("hidden") ||
    !elements.reviewGameContainer.classList.contains("hidden");
  if (!modalsOpen) {
    if (e.key === " ") { e.preventDefault(); flipCard(); }
    else if (e.key === "ArrowLeft") handlePrevious();
    else if (e.key === "ArrowRight") handleNext();
    else if (e.key === "Enter" && isFlipped) handleMarkWord("learned");
    else if (e.key === "Escape") { handleCloseDeckModal(); closeLoginModal(); closeRegisterModal(); closeChatModal(); document.body.style.overflow = ""; }
  }
}

// =========================================================
// GAMIFICATION
// =========================================================
async function trackStudyActivity() {
  if (!currentUser) return;
  try {
    const response = await fetch(`${BACKEND_API_URL}/user/study_action`, {
      method: "POST", headers: { Authorization: `Bearer ${currentUser.token}` },
    });
    if (response.ok) {
      const data = await response.json();
      const streakEl = document.getElementById("dashboard-streak");
      const xpEl = document.getElementById("dashboard-xp");
      if (streakEl) streakEl.textContent = `${data.streak} Ngày 🔥`;
      if (xpEl) xpEl.textContent = `${data.xp} XP`;
    }
  } catch { console.error("Lỗi ghi nhận học tập"); }
}

// =========================================================
// GAMIFICATION HELPERS
// =========================================================
function updateDashboardStreakUI(streak, xp) {
  const streakEl = document.getElementById("dashboard-streak");
  if (streakEl) streakEl.textContent = `${streak} Ngày 🔥`;
  const xpEl = document.getElementById("dashboard-xp");
  if (xpEl) xpEl.textContent = `${xp} XP`;
}

// =========================================================
// THEME
// =========================================================
function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === "dark") {
    html.classList.add("dark");
    // Xóa inline styles cũ nếu có
    html.style.removeProperty("--background");
    html.style.removeProperty("--foreground");
    html.style.removeProperty("--card");
    html.style.removeProperty("--card-foreground");
    html.style.removeProperty("--border");
    html.style.removeProperty("--muted");
  } else {
    html.classList.remove("dark");
    html.style.cssText = "";
  }
  // Lưu vào localStorage để group.html và các trang khác đồng bộ
  try { localStorage.setItem("vf_theme", theme); } catch {}
}

// Áp dụng theme ngay khi load trang (trước khi render) để tránh flash
(function initThemeFromStorage() {
  try {
    const saved = localStorage.getItem("vf_theme");
    if (saved === "dark") document.documentElement.classList.add("dark");
  } catch {}
})();

// =========================================================
// FILE TO TEXT (for AI import)
// =========================================================
function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file, "UTF-8");
  });
}

// =========================================================
// LIBRARY
// =========================================================
async function loadLibrary() {
  const grid = document.getElementById("library-grid");
  if (!grid) return;
  grid.innerHTML = '<p style="text-align:center;width:100%">Đang tải dữ liệu...</p>';
  if (!currentUser) { grid.innerHTML = '<p style="text-align:center">Vui lòng đăng nhập để xem thư viện.</p>'; return; }
  try {
    const response = await fetch(`${BACKEND_API_URL}/library`, { headers: { Authorization: `Bearer ${currentUser.token}` } });
    if (response.ok) renderLibrary((await response.json()).library);
    else grid.innerHTML = '<p style="text-align:center;color:red">Không thể tải thư viện.</p>';
  } catch { grid.innerHTML = '<p style="text-align:center;color:red">Lỗi kết nối.</p>'; }
}

function switchLibTab(tab) {
  const exploreBtn = document.getElementById("lib-tab-explore");
  const mineBtn = document.getElementById("lib-tab-mine");
  document.getElementById("lib-content-explore").classList.toggle("hidden", tab !== "explore");
  document.getElementById("lib-content-mine").classList.toggle("hidden", tab !== "mine");
  if (tab === "explore") {
    exploreBtn.className = "btn btn-sm btn-primary"; mineBtn.className = "btn btn-sm btn-ghost"; loadLibrary();
  } else {
    mineBtn.className = "btn btn-sm btn-primary"; exploreBtn.className = "btn btn-sm btn-ghost"; loadMySubmissions();
  }
}

async function loadMySubmissions() {
  const tableBody = document.getElementById("my-submissions-table");
  if (!tableBody) return;
  tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem">Đang tải...</td></tr>';
  try {
    const res = await fetch(`${BACKEND_API_URL}/user/submissions`, { headers: { Authorization: `Bearer ${currentUser.token}` } });
    if (res.ok) renderSubmissions((await res.json()).submissions);
  } catch { console.error("Lỗi tải đóng góp"); }
}

function renderSubmissions(submissions) {
  const tableBody = document.getElementById("my-submissions-table");
  if (!tableBody) return;
  tableBody.innerHTML = "";
  if (submissions.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem">Bạn chưa chia sẻ bộ từ nào.</td></tr>'; return;
  }
  submissions.forEach(s => {
    let statusBadge = s.share_status === "pending" ? '<span class="badge status-unlearned">Đang chờ duyệt</span>'
      : s.share_status === "approved" ? '<span class="badge status-learned">Đã đăng</span>'
      : '<span class="badge status-review">Bị từ chối</span>';
    let actionButtons = s.share_status === "approved"
      ? `<button class="btn btn-sm btn-outline" onclick="handleEditDeck('${s.id}')">Sửa</button>
         <button class="btn btn-sm btn-outline" style="color:#ef4444" onclick="handleDeleteRequest('${s.id}')">Gỡ bỏ</button>`
      : s.share_status === "pending" ? `<span style="color:#64748b;font-size:0.8rem">Đang xử lý...</span>`
      : `<button class="btn btn-sm btn-outline" onclick="handleShareDeck('${s.id}')">Gửi lại</button>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><strong>${s.name}</strong></td><td>${new Date(s.submitted_at).toLocaleDateString("vi-VN")}</td><td>${statusBadge}</td><td style="text-align:right">${actionButtons}</td>`;
    tableBody.appendChild(tr);
  });
}

async function handleDeleteRequest(deckId) {
  if (!currentUser || !confirm("Bạn có chắc muốn yêu cầu gỡ bỏ bộ từ này?")) return;
  try {
    const res = await fetch(`${BACKEND_API_URL}/decks/request_delete/${deckId}`, { method: "POST", headers: { Authorization: `Bearer ${currentUser.token}` } });
    const data = await res.json();
    alert(res.ok ? data.msg : "Lỗi: " + data.msg);
    if (res.ok) loadMySubmissions();
  } catch { alert("Không thể kết nối đến server."); }
}

window.openSubmitDeckModal = async function() {
  if (decks.length === 0) { alert("Bạn chưa có bộ từ nào."); return; }
  let msg = "Chọn bộ từ bạn muốn gửi:\n\n";
  decks.forEach((d, i) => { msg += `${i + 1}. ${d.name}\n`; });
  const choice = parseInt(prompt(msg + "\nNhập số thứ tự:")) - 1;
  if (decks[choice]) handleShareDeck(decks[choice].id);
};

function renderLibrary(libDecks) {
  const grid = document.getElementById("library-grid");
  grid.innerHTML = "";
  if (libDecks.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;background:var(--muted);border-radius:12px"><h3>Thư viện trống</h3><p>Chưa có bộ từ nào được chia sẻ.</p></div>`; return;
  }
  const icons = ["📚", "🌟", "🔥", "💡", "🎓"];
  libDecks.forEach((deck) => {
    const card = document.createElement("div");
    card.className = "data-card";
    card.style.cssText = "display:flex;flex-direction:column;transition:transform 0.2s";
    card.innerHTML = `
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;margin-bottom:10px">
          <span style="font-size:2rem">${icons[Math.floor(Math.random() * icons.length)]}</span>
          <span class="badge" style="background:#e0e7ff;color:#4338ca;height:fit-content">${deck.word_count} từ</span>
        </div>
        <h3 style="margin:0 0 5px">${deck.name}</h3>
        <p class="text-secondary" style="font-size:0.85rem;margin-bottom:15px">Tác giả: <strong>${deck.author}</strong><br>Lượt tải: ${deck.downloads}</p>
      </div>
      <button class="btn btn-primary btn-full" onclick="handleCloneDeck('${deck.id}')">
        <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="12" x2="12" y2="3"/></svg>
        Tải Về
      </button>`;
    card.onmouseover = () => card.style.transform = "translateY(-5px)";
    card.onmouseout = () => card.style.transform = "translateY(0)";
    grid.appendChild(card);
  });
}

window.handleCloneDeck = async function(deckId) {
  if (!confirm("Thêm bộ từ này vào danh sách học của bạn?")) return;
  const btn = event.target.closest("button");
  const oldText = btn.innerHTML; btn.disabled = true; btn.textContent = "Đang tải...";
  try {
    const res = await fetch(`${BACKEND_API_URL}/library/clone/${deckId}`, { method: "POST", headers: { Authorization: `Bearer ${currentUser.token}` } });
    if (res.ok) {
      alert("Đã thêm thành công!"); await loadDataFromStorage(); renderDeckList();
    } else { alert((await res.json()).msg || "Lỗi."); }
  } catch { alert("Lỗi kết nối."); }
  finally { btn.disabled = false; btn.innerHTML = oldText; }
};

// =========================================================
// SETTINGS
// =========================================================
async function setupSettings() {
  if (!currentUser) return;
  const voiceSelect = document.getElementById("setting-voice");
  const testVoiceBtn = document.getElementById("test-user-voice-btn");
  const saveBtn = document.getElementById("save-settings-btn");
  try {
    const voicesRes = await fetch(`${BACKEND_API_URL}/voices`, { headers: { Authorization: `Bearer ${currentUser.token}` } });
    if (voicesRes.ok && voiceSelect) {
      const data = await voicesRes.json();
      voiceSelect.innerHTML = "";
      data.voices.forEach(v => {
        const opt = document.createElement("option"); opt.value = v.id; opt.textContent = v.name; voiceSelect.appendChild(opt);
      });
    }
    const userRes = await fetch(`${BACKEND_API_URL}/user/me`, { headers: { Authorization: `Bearer ${currentUser.token}` } });
    if (userRes.ok) {
      const userData = await userRes.json();
      document.getElementById("setting-email").value = userData.username || "";
      document.getElementById("setting-daily-goal").value = userData.daily_goal || 5;
      document.getElementById("setting-theme").value = userData.theme || "light";
      if (voiceSelect && userData.preferred_voice) { voiceSelect.value = userData.preferred_voice; currentUser.preferred_voice = userData.preferred_voice; }
      if (userData.theme) applyTheme(userData.theme);
    }
  } catch { console.error("Lỗi đồng bộ cài đặt"); }
  if (saveBtn && saveBtn.parentNode) {
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    newSaveBtn.addEventListener("click", handleSaveSettings);
  } else if (saveBtn) {
    saveBtn.removeEventListener("click", handleSaveSettings);
    saveBtn.addEventListener("click", handleSaveSettings);
  }
  if (testVoiceBtn) {
    testVoiceBtn.onclick = (e) => {
      e.preventDefault();
      if (voiceSelect) new Audio(`${BACKEND_API_URL}/audio?text=Hello, this is my new voice.&voice=${voiceSelect.value}`).play();
    };
  }
}

async function handleSaveSettings() {
  const goalInput = document.getElementById("setting-daily-goal");
  const themeSelect = document.getElementById("setting-theme");
  const voiceSelect = document.getElementById("setting-voice");
  const newPassInput = document.getElementById("setting-new-password");
  const confirmPassInput = document.getElementById("setting-confirm-password");
  const saveBtn = document.getElementById("save-settings-btn");
  if (!currentUser) { alert("Vui lòng đăng nhập."); return; }
  const payload = { daily_goal: goalInput.value, theme: themeSelect.value, preferred_voice: voiceSelect ? voiceSelect.value : "en-US-AriaNeural" };
  if (newPassInput.value) {
    if (newPassInput.value.length < 6) { alert("Mật khẩu mới phải có ít nhất 6 ký tự."); return; }
    if (newPassInput.value !== confirmPassInput.value) { alert("Mật khẩu xác nhận không khớp."); return; }
    payload.new_password = newPassInput.value;
  }
  saveBtn.disabled = true; saveBtn.textContent = "Đang lưu...";
  try {
    const res = await fetch(`${BACKEND_API_URL}/user/settings`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentUser.token}` }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      alert("Cập nhật cài đặt thành công!");
      if (voiceSelect) {
        currentUser.preferred_voice = voiceSelect.value;
        window.currentUser = currentUser;
        // Lưu vào localStorage để persist
        try {
          const stored = JSON.parse(localStorage.getItem('vocabflow_currentUser') || '{}');
          stored.preferred_voice = voiceSelect.value;
          localStorage.setItem('vocabflow_currentUser', JSON.stringify(stored));
        } catch(e) {}
      }
      applyTheme(themeSelect.value);
      newPassInput.value = ""; confirmPassInput.value = "";
    }
    else alert(`Lỗi: ${data.msg}`);
  } catch { alert("Không thể kết nối đến server."); }
  finally { saveBtn.disabled = false; saveBtn.textContent = "Lưu Thay Đổi"; }
}

// =========================================================
// PROGRESS VIEW
// =========================================================
async function loadProgressViewData() {
  try {
    if (difficultyChart) difficultyChart.destroy();
    if (dailyWordsChart) dailyWordsChart.destroy();
  } catch {}
  difficultyChart = null; dailyWordsChart = null;
  if (!currentUser) return;
  try {
    const res = await fetch(`${BACKEND_API_URL}/statistics`, { headers: { Authorization: `Bearer ${currentUser.token}` } });
    if (!res.ok) return;
    const stats = await res.json();
    if (elements.totalLearnedCount) elements.totalLearnedCount.textContent = stats.learned_words_count || 0;
    if (elements.currentStreakVal) elements.currentStreakVal.textContent = `${stats.streak_days || 0} Ngày 🔥`;
    if (elements.averageWeeklyWords) elements.averageWeeklyWords.textContent = stats.average_weekly_words || 0;
    if (elements.totalXpVal) elements.totalXpVal.textContent = `${stats.total_xp || 0} XP ⚡`;
    updateDailyGoalUI(stats.words_learned_today, stats.daily_goal);
    const canvasDiff = document.getElementById("difficultyDistributionChart");
    if (canvasDiff) {
      difficultyChart = new Chart(canvasDiff.getContext("2d"), {
        type: "doughnut",
        data: { labels: ["Đã nắm vững", "Đang ôn tập", "Chưa học"], datasets: [{ data: [stats.learned_words_count, stats.review_words_count, stats.pending_words_count], backgroundColor: ["#10b981", "#f59e0b", "#94a3b8"], hoverOffset: 4 }] },
        options: { responsive: true, maintainAspectRatio: false },
      });
    }
    const canvasDaily = document.getElementById("dailyLearnedWordsChart");
    if (canvasDaily) {
      const labels = (stats.words_learned_daily || []).map(item => new Date(item.date).toLocaleDateString("vi-VN", { day: "numeric", month: "numeric" }));
      const dataPoints = (stats.words_learned_daily || []).map(item => item.count);
      dailyWordsChart = new Chart(canvasDaily.getContext("2d"), {
        type: "line",
        data: { labels, datasets: [{ label: "Từ đã học", data: dataPoints, borderColor: "#6366f1", backgroundColor: "rgba(99,102,241,0.1)", fill: true, tension: 0.4 }] },
        options: { responsive: true, maintainAspectRatio: false },
      });
    }
    if (elements.activityList) {
      elements.activityList.innerHTML = "";
      if (stats.recent_activities && stats.recent_activities.length > 0) {
        stats.recent_activities.forEach(a => {
          const li = document.createElement("li");
          li.innerHTML = `<span class="activity-date">${a.updated_at}</span> Bạn đã học từ "<strong>${a.word}</strong>"`;
          elements.activityList.appendChild(li);
        });
      } else elements.activityList.innerHTML = "<li>Chưa có hoạt động nào.</li>";
    }
    fetchLeaderboard();
  } catch { console.error("Lỗi xử lý dữ liệu tiến độ"); }
}

async function fetchLeaderboard() {
  try {
    const res = await fetch(`${BACKEND_API_URL}/leaderboard`, { headers: { Authorization: `Bearer ${currentUser.token}` } });
    if (res.ok) renderLeaderboard((await res.json()).leaderboard);
  } catch { console.error("Lỗi tải xếp hạng"); }
}

function renderLeaderboard(users) {
  if (!elements.leaderboardBody) return;

  // Render table rows (desktop)
  elements.leaderboardBody.innerHTML = "";
  users.forEach((user, index) => {
    const tr = document.createElement("tr");
    let rankDisplay = index + 1;
    if (index === 0) rankDisplay = "🥇"; else if (index === 1) rankDisplay = "🥈"; else if (index === 2) rankDisplay = "🥉";
    tr.innerHTML = `
      <td style="font-weight:800;font-size:1.1rem;text-align:center">${rankDisplay}</td>
      <td><strong>${(user.username || "Ẩn danh").split("@")[0]}</strong></td>
      <td class="leaderboard-streak-col" style="text-align:center">${user.streak || 0} 🔥</td>
      <td style="text-align:right;font-weight:700;color:hsl(var(--primary))">${(user.xp || 0).toLocaleString()} XP</td>`;
    elements.leaderboardBody.appendChild(tr);
  });

  // Render card layout (mobile ≤480px)
  const cardsEl = document.getElementById('leaderboard-cards');
  if (!cardsEl) return;
  const rankEmojis = ['🥇','🥈','🥉'];
  const rankClasses = ['lb-rank-1','lb-rank-2','lb-rank-3'];
  cardsEl.innerHTML = users.map((user, i) => `
    <div class="lb-card">
      <div class="lb-rank ${rankClasses[i] || ''}">${rankEmojis[i] || (i+1)}</div>
      <div class="lb-info">
        <div class="lb-name">${esc((user.username || "Ẩn danh").split("@")[0])}</div>
        <div class="lb-streak">${user.streak || 0} 🔥 chuỗi ngày</div>
      </div>
      <div class="lb-xp">${(user.xp || 0).toLocaleString()} XP</div>
    </div>`).join('');
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function updateDailyGoalUI(current, goal) {
  if (!elements.dailyGoalText || !elements.dailyGoalProgress) return;
  elements.dailyGoalText.textContent = `${current || 0}/${goal || 5} từ`;
  elements.dailyGoalProgress.style.width = `${Math.min(Math.round(((current || 0) / (goal || 5)) * 100), 100)}%`;
}

// =========================================================
// SAVE DECK
// =========================================================
async function handleSaveDeck() {
  const name = elements.deckNameInput.value.trim();
  if (!name) { alert("Tên bộ từ là bắt buộc."); return; }
  const words = Array.from(elements.wordInputsContainer.querySelectorAll(".word-input-group"))
    .map((g) => ({
      id: g.querySelector(".word-id-input").value,
      word: g.querySelector(".word-input").value.trim(),
      ipa: g.querySelector(".ipa-input").value.trim(),
      meaning: g.querySelector(".meaning-input").value.trim(),
      example: { en: g.querySelector(".example-en-input").value.trim(), vi: g.querySelector(".example-vi-input").value.trim() },
    }))
    .filter((w) => w.word && w.meaning);
  if (words.length === 0) { alert("Vui lòng thêm ít nhất một từ."); return; }

  // ── Save bộ từ nhóm ──────────────────────────────────
  if (editingDeckId && editingDeckId.startsWith('GROUP:')) {
    const parts = editingDeckId.split(':'); // GROUP:groupId:deckId
    const groupId = parts[1], deckId = parts[2];
    if (!currentUser) { alert("Vui lòng đăng nhập."); return; }
    try {
      const res = await fetch(`${BACKEND_API_URL}/groups/${groupId}/decks/${deckId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentUser.token}` },
        body: JSON.stringify({ name, words })
      });
      const data = await res.json();
      if (res.ok) {
        alert("Đã cập nhật bộ từ nhóm!");
        handleCloseDeckModal();
        editingDeckId = null;
        loadGroupDecksToSidebar(); // reload group tab
        return;
      } else { alert(`Lỗi: ${data.msg}`); return; }
    } catch { alert("Không thể kết nối server."); return; }
  }

  // ── Save bộ từ thường ─────────────────────────────────
  const deckData = { name, words };
  let method = "POST", url = `${BACKEND_API_URL}/decks`;
  if (editingDeckId) { method = "PUT"; url = `${BACKEND_API_URL}/decks/${editingDeckId}`; }
  if (currentUser) {
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentUser.token}` }, body: JSON.stringify(deckData) });
      const data = await res.json();
      if (res.ok) {
        alert(data.msg || "Bộ từ đã được lưu!");
        await loadDataFromStorage(); renderDeckList(); handleCloseDeckModal();
        if (editingDeckId === activeDeckId) { currentIndex = 0; isFlipped = false; elements.flashcard.classList.remove("flipped"); elements.actionButtons.classList.remove("show"); updateDisplay(); }
        else if (!activeDeckId && decks.length > 0) handleSelectDeck(decks[0].id);
        editingDeckId = null; return;
      } else alert(`Lỗi: ${data.msg || "Không xác định"}`);
    } catch { alert("Không thể kết nối đến server."); }
  }
  // Fallback local
  if (editingDeckId) {
    const i = decks.findIndex(d => d.id === editingDeckId);
    if (i > -1) decks[i] = { ...decks[i], name, words };
  } else {
    decks.push({ id: `deck-${Date.now()}`, name, words });
  }
  saveDataToStorage(); renderDeckList(); handleCloseDeckModal();
  if (editingDeckId === activeDeckId) { currentIndex = 0; isFlipped = false; elements.flashcard.classList.remove("flipped"); updateDisplay(); }
  else if (!activeDeckId && decks.length > 0) handleSelectDeck(decks[0].id);
  editingDeckId = null;
}

// =========================================================
// AUTH MODALS
// =========================================================
function openRegisterModal() { document.body.style.overflow="hidden"; elements.registerModal.classList.remove("hidden"); elements.registerEmailInput.value = ""; elements.registerPasswordInput.value = ""; elements.registerMessage.textContent = ""; elements.registerMessage.classList.add("hidden"); }
function closeRegisterModal() { elements.registerModal.classList.add("hidden"); document.body.style.overflow=""; }
function openLoginModal() { document.body.style.overflow="hidden"; elements.loginModal.classList.remove("hidden"); elements.loginEmailInput.value = ""; elements.loginPasswordInput.value = ""; elements.loginMessage.textContent = ""; elements.loginMessage.classList.add("hidden"); }
function closeLoginModal() { elements.loginModal.classList.add("hidden"); document.body.style.overflow=""; }

function displayAuthMessage(element, message, type = "info") {
  element.textContent = message;
  element.classList.remove("success", "error", "hidden");
  if (type === "success") element.classList.add("success");
  else if (type === "error") element.classList.add("error");
  setTimeout(() => { element.classList.add("hidden"); element.textContent = ""; }, 5000);
}

async function registerUser(username, password, loginType) {
  try {
    const res = await fetch(`${BACKEND_API_URL}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, login_type: loginType }) });
    const data = await res.json();
    if (res.ok) {
      displayAuthMessage(elements.registerMessage, data.msg || "Đăng ký thành công! Vui lòng đăng nhập.", "success");
      setTimeout(() => { closeRegisterModal(); openLoginModal(); elements.loginEmailInput.value = username; }, 1500);
    } else displayAuthMessage(elements.registerMessage, `Đăng ký thất bại: ${data.msg}`, "error");
  } catch { displayAuthMessage(elements.registerMessage, "Không thể kết nối đến server.", "error"); }
}

async function loginUser(username, password, loginType) {
  const loginBtn = document.getElementById("login-email-btn");
  const origText = loginBtn ? loginBtn.innerText : "Đăng Nhập";
  if (loginBtn) { loginBtn.disabled = true; loginBtn.innerText = "Đang xử lý..."; }
  try {
    const res = await fetch(`${BACKEND_API_URL}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, login_type: loginType }) });
    // Check maintenance mode - block user login
    if (res.status === 503) {
      const mData = await res.json().catch(() => ({}));
      if (loginBtn) { loginBtn.disabled = false; loginBtn.innerText = origText; }
      closeLoginModal();
      showMaintenanceOverlay(mData);
      return;
    }
    const data = await res.json();
    if (res.ok) {
      displayAuthMessage(elements.loginMessage, "Đăng nhập thành công!", "success");
      localStorage.setItem("vocabflow_authToken", data.access_token);
      localStorage.setItem("vocabflow_currentUser", JSON.stringify({ id: data.userId, username: data.username, role: data.role }));
      currentUser = { id: data.userId, username: data.username, token: data.access_token, role: data.role };
      window.currentUser = currentUser; // expose ra window
      chatSessions = []; activeSessionId = null; activeSessionMessages = []; chatLayoutRendered = false;
      setTimeout(async () => {
        closeLoginModal(); updateAuthUI();
        if (currentUser.role === "admin") { alert("Xin chào Admin! Chuyển đến Bảng Quản Trị."); window.open("/admin", "_blank"); return; }
        try { await loadDataFromStorage(); renderDeckList(); if (decks.length > 0) handleSelectDeck(decks[0].id); else showPlaceholder(false); updateDisplay(); switchView("dashboard"); }
        catch (err) { console.error("Lỗi sau đăng nhập:", err); }
      }, 1000);
    } else {
      displayAuthMessage(elements.loginMessage, `Đăng nhập thất bại: ${data.msg}`, "error");
      if (loginBtn) { loginBtn.disabled = false; loginBtn.innerText = origText; }
    }
  } catch {
    displayAuthMessage(elements.loginMessage, "Lỗi kết nối Server.", "error");
    if (loginBtn) { loginBtn.disabled = false; loginBtn.innerText = origText; }
  }
}

async function handleRegisterEmail() {
  const u = elements.registerEmailInput.value.trim(), p = elements.registerPasswordInput.value.trim();
  if (!u || !p) { displayAuthMessage(elements.registerMessage, "Vui lòng nhập đầy đủ.", "error"); return; }
  await registerUser(u, p, "email");
}
async function handleLoginEmail() {
  const u = elements.loginEmailInput.value.trim(), p = elements.loginPasswordInput.value.trim();
  if (!u || !p) { displayAuthMessage(elements.loginMessage, "Vui lòng nhập đầy đủ.", "error"); return; }
  await loginUser(u, p, "email");
}
async function handleRegisterFacebook() {
  const u = elements.registerEmailInput.value.trim(), p = elements.registerPasswordInput.value.trim();
  if (!u || !p) { displayAuthMessage(elements.registerMessage, "Vui lòng nhập đầy đủ.", "error"); return; }
  await registerUser(u, p, "facebook");
}
async function handleLoginFacebook() {
  const u = elements.loginEmailInput.value.trim(), p = elements.loginPasswordInput.value.trim();
  if (!u || !p) { displayAuthMessage(elements.loginMessage, "Vui lòng nhập đầy đủ.", "error"); return; }
  await loginUser(u, p, "facebook");
}

async function handleLogout(isSilent = false) {
  if (!isSilent && !confirm("Bạn có muốn đăng xuất không?")) return;
  localStorage.removeItem("vocabflow_authToken");
  localStorage.removeItem("vocabflow_currentUser");
  window.currentUser = null;
  window._avatarCache = null;
  // Reload trang để reset hoàn toàn UI về trạng thái chưa đăng nhập
  window.location.reload();
}

// =========================================================
// ██████╗██╗  ██╗ █████╗ ████████╗     ███████╗███████╗███████╗███████╗██╗ ██████╗ ███╗   ██╗███████╗
// ██╔════╝██║  ██║██╔══██╗╚══██╔══╝     ██╔════╝██╔════╝██╔════╝██╔════╝██║██╔═══██╗████╗  ██║██╔════╝
// ██║     ███████║███████║   ██║        ███████╗█████╗  ███████╗███████╗██║██║   ██║██╔██╗ ██║███████╗
// ██║     ██╔══██║██╔══██║   ██║        ╚════██║██╔══╝  ╚════██║╚════██║██║██║   ██║██║╚██╗██║╚════██║
// ╚██████╗██║  ██║██║  ██║   ██║        ███████║███████╗███████║███████║██║╚██████╔╝██║ ╚████║███████║
//  ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝        ╚══════╝╚══════╝╚══════╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝
// SESSION-BASED MULTI-THREAD AI CHAT
// =========================================================

function closeChatModal() {
  if (elements.chatModal) elements.chatModal.classList.add("hidden");
  document.body.style.overflow = "";
}

function getChatMessagesArea() {
  return document.getElementById("chat-messages-area");
}

function scrollToBottomOfChat() {
  const area = getChatMessagesArea();
  if (area) area.scrollTop = area.scrollHeight;
}

/**
 * Mở chat modal. Lần đầu: render layout 2 cột + load sessions.
 * Lần tiếp theo: chỉ refresh sessions list.
 */
async function openChatModal() {
  if (!currentUser) {
    alert("Vui lòng đăng nhập để sử dụng tính năng AI Coach.");
    openLoginModal();
    return;
  }
  if (!elements.chatModal) return;
  elements.chatModal.classList.remove("hidden"); document.body.style.overflow="hidden";

  if (!chatLayoutRendered) {
    buildChatLayout();
    chatLayoutRendered = true;
  }

  await loadChatSessions();

  if (activeSessionId) {
    highlightActiveSession(activeSessionId);
    // Không reload nếu đã có messages
    if (activeSessionMessages.length === 0) {
      await loadSessionMessages(activeSessionId);
    } else {
      renderMessages(activeSessionMessages);
    }
  } else if (chatSessions.length > 0) {
    await loadSessionMessages(chatSessions[0].id);
  } else {
    showEmptyChatState();
  }
}

/**
 * Build layout 2 cột vào trong chat-modal.
 * Gọi một lần duy nhất sau khi user đăng nhập.
 */
function buildChatLayout() {
  if (!elements.chatModal) return;

  /* ── Modal container ───────────────────────── */
  const content = elements.chatModal.querySelector('.chat-modal-content') || elements.chatModal.querySelector('.modal');
  if (content) {
    content.style.cssText = `
      max-width:900px;
      width:calc(100vw - 2rem);
      height:calc(100vh - 3rem);
      max-height:800px;
      display:flex;flex-direction:column;overflow:hidden;
      border-radius:16px;
    `;
  }

  /* ── Header ───────────────────────────────── */
  const header = elements.chatModal.querySelector('.modal-header');
  if (header) {
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid hsl(var(--border)/0.5);flex-shrink:0;gap:8px;';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;min-width:0">
        <div style="width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,hsl(214 90% 52%),hsl(225 85% 60%));display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 3px 10px rgba(29,110,234,0.3)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
            <circle cx="9" cy="13" r="1" fill="white" stroke="none"/><circle cx="15" cy="13" r="1" fill="white" stroke="none"/>
          </svg>
        </div>
        <div style="min-width:0">
          <div style="font-weight:700;font-size:0.88rem;color:hsl(var(--foreground));white-space:nowrap">VocabFlow AI Coach</div>
          <div style="font-size:0.65rem;color:hsl(var(--muted-foreground));display:flex;align-items:center;gap:3px">
            <span style="width:5px;height:5px;border-radius:50%;background:#10b981;display:inline-block;flex-shrink:0"></span>Powered by Gemini AI
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <!-- Nút "Cuộc hội thoại mới" - ẩn trên mobile khi sidebar đóng -->
        <button id="new-chat-btn" title="Cuộc hội thoại mới" style="
          display:flex;align-items:center;gap:4px;padding:5px 10px;border-radius:8px;
          border:1.5px solid hsl(214 90% 52% / 0.3);background:hsl(214 90% 52% / 0.08);
          color:hsl(214 90% 52%);font-size:0.76rem;font-weight:600;cursor:pointer;
          transition:all 0.2s;font-family:inherit;white-space:nowrap">
          <svg style="width:11px;height:11px;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Cuộc hội thoại mới
        </button>
        <!-- Toggle sidebar -->
        <button id="toggle-chat-sidebar-btn" title="Lịch sử chat" style="
          display:flex;align-items:center;justify-content:center;
          width:32px;height:32px;border-radius:8px;border:1.5px solid hsl(var(--border));
          background:hsl(var(--muted)/0.6);cursor:pointer;flex-shrink:0;transition:all 0.2s">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <button id="close-chat-modal-btn-inner" style="width:30px;height:30px;border-radius:8px;border:none;background:hsl(var(--muted));cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center;flex-shrink:0">&times;</button>
      </div>`;

    header.querySelector('#close-chat-modal-btn-inner').addEventListener('click', closeChatModal);
    header.querySelector('#new-chat-btn').addEventListener('click', handleNewChatSession);
  }

  /* ── Body: sidebar + main ─────────────────── */
  const body = elements.chatModal.querySelector('.modal-body');
  if (body) {
    body.className = '';
    body.style.cssText = 'flex:1;display:flex;min-height:0;overflow:hidden;padding:0;gap:0;position:relative;';
    body.innerHTML = `
      <!-- SIDEBAR -->
      <div id="chat-sidebar" style="
        width:220px;min-width:220px;
        border-right:1px solid hsl(var(--border)/0.5);
        display:flex;flex-direction:column;overflow:hidden;
        background:hsl(var(--muted)/0.35);
        transition:transform 0.25s cubic-bezier(0.4,0,0.2,1),width 0.25s;
        flex-shrink:0;">
        <div style="padding:10px 12px 7px;border-bottom:1px solid hsl(var(--border)/0.4);display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:0.64rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:hsl(var(--muted-foreground))">Lịch Sử Chat</span>
          <button id="new-chat-sidebar-btn" title="Tạo mới" style="
            width:22px;height:22px;border-radius:6px;border:none;
            background:hsl(214 90% 52%/0.12);color:hsl(214 90% 52%);
            cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700">+</button>
        </div>
        <div id="chat-sessions-list" style="flex:1;overflow-y:auto;padding:5px;"></div>
      </div>

      <!-- OVERLAY (mobile) -->
      <div id="chat-sidebar-overlay" style="display:none;position:absolute;inset:0;z-index:19;background:hsl(0 0% 0%/0.4);backdrop-filter:blur(2px);cursor:pointer;"></div>

      <!-- MAIN -->
      <div id="chat-main-area" style="flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden;">
        <!-- Empty state -->
        <div id="chat-empty-state" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem 1.5rem;gap:1rem;text-align:center">
          <div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,hsl(214 90% 52%),hsl(225 85% 60%));display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(29,110,234,0.3)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
              <circle cx="9" cy="13" r="1" fill="white" stroke="none"/><circle cx="15" cy="13" r="1" fill="white" stroke="none"/>
            </svg>
          </div>
          <div>
            <div style="font-weight:700;font-size:0.95rem;margin-bottom:4px">Xin chào! Tôi là AI Coach</div>
            <div style="font-size:0.78rem;color:hsl(var(--muted-foreground));line-height:1.5;max-width:260px">Hỏi bất cứ điều gì về từ vựng, ngữ pháp hoặc luyện tập tiếng Anh</div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-width:320px">
            <button class="chat-suggest-btn" onclick="insertSuggestion('Giải thích nghĩa từ ephemeral')">💡 Giải thích từ khó</button>
            <button class="chat-suggest-btn" onclick="insertSuggestion('Tạo 10 từ vựng IELTS band 7')">✨ Tạo bộ từ vựng</button>
            <button class="chat-suggest-btn" onclick="insertSuggestion('Sửa lỗi ngữ pháp cho câu này:')">✍️ Sửa ngữ pháp</button>
            <button class="chat-suggest-btn" onclick="insertSuggestion('Phân tích bài đọc tiếng Anh')">📖 Phân tích bài đọc</button>
          </div>
        </div>

        <!-- Messages -->
        <div id="chat-messages-area" style="flex:1;overflow-y:auto;padding:1rem 1.25rem;display:flex;flex-direction:column;gap:0.85rem;display:none;"></div>

        <!-- Input -->
        <div style="padding:10px 12px;border-top:1px solid hsl(var(--border)/0.5);background:hsl(var(--background)/0.8);backdrop-filter:blur(8px);flex-shrink:0">
          <div style="display:flex;gap:8px;align-items:flex-end;background:hsl(var(--muted)/0.4);border:1.5px solid hsl(var(--border));border-radius:13px;padding:7px 9px;transition:border-color 0.2s" id="chat-input-wrap">
            <textarea id="chat-input-new" placeholder="Nhập tin nhắn..." rows="1" maxlength="1000" style="
              flex:1;border:none;background:transparent;resize:none;outline:none;
              font-family:inherit;font-size:0.88rem;line-height:1.5;max-height:100px;
              color:hsl(var(--foreground));padding:0;"></textarea>
            <button id="send-chat-btn-new" style="
              width:34px;height:34px;border-radius:9px;border:none;cursor:pointer;flex-shrink:0;
              background:linear-gradient(135deg,hsl(214 90% 52%),hsl(225 85% 60%));
              display:flex;align-items:center;justify-content:center;
              box-shadow:0 3px 10px rgba(29,110,234,0.3);transition:all 0.2s">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
          <div style="text-align:center;margin-top:4px;font-size:0.62rem;color:hsl(var(--muted-foreground))">Enter gửi · Shift+Enter xuống dòng</div>
        </div>
      </div>`;

    /* ── Bind events ─── */
    const newInput   = body.querySelector('#chat-input-new');
    const newSendBtn = body.querySelector('#send-chat-btn-new');
    const overlay    = body.querySelector('#chat-sidebar-overlay');
    const newChatSidebarBtn = body.querySelector('#new-chat-sidebar-btn');
    elements.chatInput   = newInput;
    elements.sendChatBtn = newSendBtn;

    if (newInput) {
      const wrap = body.querySelector('#chat-input-wrap');
      newInput.addEventListener('focus',  () => { if (wrap) wrap.style.borderColor = 'hsl(214 90% 52% / 0.5)'; });
      newInput.addEventListener('blur',   () => { if (wrap) wrap.style.borderColor = 'hsl(var(--border))'; });
      newInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
      });
      newInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 100) + 'px';
      });
    }
    if (newSendBtn) {
      newSendBtn.addEventListener('click', handleSendMessage);
      newSendBtn.addEventListener('mouseenter', (e) => e.currentTarget.style.transform = 'scale(1.08)');
      newSendBtn.addEventListener('mouseleave', (e) => e.currentTarget.style.transform = 'scale(1)');
    }
    if (overlay) overlay.addEventListener('click', () => _showChatSidebar(false));
    if (newChatSidebarBtn) newChatSidebarBtn.addEventListener('click', handleNewChatSession);
  }

  /* ── Footer ─── */
  const footer = elements.chatModal.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';

  /* ── Sidebar toggle logic ─── */
  const header2 = elements.chatModal.querySelector('.modal-header');
  const toggleBtn = header2 && header2.querySelector('#toggle-chat-sidebar-btn');
  const newChatBtn = header2 && header2.querySelector('#new-chat-btn');

  const MQ = window.matchMedia('(max-width: 680px)');

  window._chatSidebarVisible = false;
  window._chatIsMobile       = MQ.matches;

  function _applyMode(isMobile) {
    window._chatIsMobile = isMobile;
    const sb = document.getElementById('chat-sidebar');
    if (!sb) return;
    if (isMobile) {
      // Mobile: absolute overlay, mặc định ẨN
      sb.style.cssText = `
        position:absolute;top:0;left:0;bottom:0;z-index:20;
        width:240px;min-width:240px;
        border-right:1px solid hsl(var(--border)/0.5);
        display:flex;flex-direction:column;overflow:hidden;
        background:hsl(var(--card));
        transform:translateX(-100%);
        transition:transform 0.25s cubic-bezier(0.4,0,0.2,1);
        box-shadow:4px 0 24px hsl(0 0% 0%/0.15);
      `;
      sb.parentElement && (sb.parentElement.style.position = 'relative');
      if (newChatBtn) newChatBtn.style.display = 'none';
      window._chatSidebarVisible = false;
      _updateToggleBtn(false);
    } else {
      // Desktop: static, luôn hiện
      sb.style.cssText = `
        width:220px;min-width:220px;
        border-right:1px solid hsl(var(--border)/0.5);
        display:flex;flex-direction:column;overflow:hidden;
        background:hsl(var(--muted)/0.35);
        flex-shrink:0;
      `;
      sb.parentElement && (sb.parentElement.style.position = 'relative');
      if (newChatBtn) newChatBtn.style.display = 'flex';
      window._chatSidebarVisible = true;
      _updateToggleBtn(true);
      const ov = document.getElementById('chat-sidebar-overlay');
      if (ov) ov.style.display = 'none';
    }
  }

  window._showChatSidebar = function(show) {
    const sb = document.getElementById('chat-sidebar');
    const ov = document.getElementById('chat-sidebar-overlay');
    if (!sb) return;
    window._chatSidebarVisible = show;
    _updateToggleBtn(show);
    if (window._chatIsMobile) {
      sb.style.transform = show ? 'translateX(0)' : 'translateX(-100%)';
      if (ov) ov.style.display = show ? 'block' : 'none';
    } else {
      sb.style.display = show ? 'flex' : 'none';
      if (newChatBtn) newChatBtn.style.display = show ? 'flex' : 'none';
    }
  };

  function _updateToggleBtn(active) {
    if (!toggleBtn) return;
    toggleBtn.style.background   = active ? 'hsl(214 90% 52%/0.12)' : 'hsl(var(--muted)/0.6)';
    toggleBtn.style.borderColor  = active ? 'hsl(214 90% 52%/0.4)'  : 'hsl(var(--border))';
    toggleBtn.style.color        = active ? 'hsl(214 90% 52%)'       : 'hsl(var(--foreground))';
  }

  if (toggleBtn) toggleBtn.addEventListener('click', () => window._showChatSidebar(!window._chatSidebarVisible));

  // Đóng sidebar khi chọn session (mobile)
  window._chatCloseSidebarOnSelect = () => {
    if (window._chatIsMobile && window._chatSidebarVisible) window._showChatSidebar(false);
  };

  MQ.addEventListener('change', (e) => _applyMode(e.matches));
  _applyMode(MQ.matches);
}


// Gợi ý câu hỏi cho chat
function insertSuggestion(text) {
  const inp = document.getElementById('chat-input-new');
  if (inp) {
    inp.value = text;
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 100) + 'px';
    inp.focus();
  }
}
// ── SESSIONS ──────────────────────────────────────────────

async function loadChatSessions() {
  try {
    const res = await fetch(`${BACKEND_API_URL}/ai/sessions`, {
      headers: { Authorization: `Bearer ${currentUser.token}` },
    });
    if (res.ok) chatSessions = (await res.json()).sessions || [];
    else chatSessions = [];
  } catch { chatSessions = []; }
  renderSessionsSidebar();
}

function renderSessionsSidebar() {
  const list = document.getElementById("chat-sessions-list");
  if (!list) return;
  list.innerHTML = "";
  if (chatSessions.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:2rem 1rem;color:hsl(var(--muted-foreground))">
        <div style="font-size:2.5rem;margin-bottom:0.5rem">💬</div>
        <div style="font-size:0.78rem;line-height:1.5">Chưa có cuộc<br>trò chuyện nào</div>
      </div>`; return;
  }
  chatSessions.forEach((session) => {
    const isActive = session.id === activeSessionId;
    const item = document.createElement("div");
    item.dataset.sessionId = session.id;
    item.style.cssText = `
      display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:10px;
      cursor:pointer;margin-bottom:3px;transition:all 0.15s;position:relative;
      background:${isActive ? "hsl(214 90% 52% / 0.12)" : "transparent"};
      border:1px solid ${isActive ? "hsl(214 90% 52% / 0.25)" : "transparent"};`;
    const date = new Date(session.updated_at).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
    item.innerHTML = `
      <div style="flex:1;min-width:0">
        <div style="font-size:0.8rem;font-weight:${isActive ? "600" : "500"};color:hsl(var(--foreground));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4">${session.title}</div>
        <div style="font-size:0.68rem;color:hsl(var(--muted-foreground));margin-top:1px">${date} · ${Math.floor(session.message_count / 2)} tin</div>
      </div>
      <button class="session-del-btn" title="Xóa" style="
        width:22px;height:22px;border-radius:6px;border:none;background:transparent;
        color:hsl(var(--muted-foreground));cursor:pointer;display:flex;align-items:center;
        justify-content:center;opacity:0;transition:opacity 0.15s;flex-shrink:0">
        <svg style="width:11px;height:11px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
      </button>`;
    item.addEventListener("mouseenter", () => {
      if (session.id !== activeSessionId) item.style.background = "hsl(var(--muted))";
      item.querySelector(".session-del-btn").style.opacity = "1";
    });
    item.addEventListener("mouseleave", () => {
      if (session.id !== activeSessionId) item.style.background = "transparent";
      item.querySelector(".session-del-btn").style.opacity = "0";
    });
    item.addEventListener("click", (e) => {
      if (!e.target.closest(".session-del-btn")) loadSessionMessages(session.id);
    });
    item.querySelector(".session-del-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      handleDeleteSession(session.id);
    });
    list.appendChild(item);
  });
}

function highlightActiveSession(sessionId) {
  const items = document.querySelectorAll("#chat-sessions-list > div[data-session-id]");
  items.forEach(item => {
    const isActive = item.dataset.sessionId === sessionId;
    item.style.background = isActive ? "hsl(214 90% 52% / 0.12)" : "transparent";
    item.style.border = `1px solid ${isActive ? "hsl(214 90% 52% / 0.25)" : "transparent"}`;
    const title = item.querySelector("div > div:first-child");
    if (title) title.style.fontWeight = isActive ? "600" : "500";
  });
}

async function loadSessionMessages(sessionId) {
  activeSessionId = sessionId;
  activeSessionMessages = []; // reset ngay để tránh history cũ lẫn vào session mới
  highlightActiveSession(sessionId);
  // Đóng sidebar trên mobile khi chọn session
  if (typeof window._chatCloseSidebarOnSelect === "function") window._chatCloseSidebarOnSelect();
  const messagesArea = getChatMessagesArea();
  if (!messagesArea) return;
  messagesArea.innerHTML = `<div style="text-align:center;padding:2rem;color:hsl(var(--muted-foreground));font-size:0.85rem;margin:auto">Đang tải tin nhắn...</div>`;
  try {
    const res = await fetch(`${BACKEND_API_URL}/ai/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${currentUser.token}` },
    });
    if (res.ok) {
      const data = await res.json();
      activeSessionMessages = data.messages || [];
      renderMessages(activeSessionMessages);
    }
  } catch { messagesArea.innerHTML = `<div style="text-align:center;padding:2rem;color:#ef4444">Lỗi tải tin nhắn.</div>`; }
}

function renderMessages(messages) {
  const messagesArea = getChatMessagesArea();
  if (!messagesArea) return;
  messagesArea.innerHTML = "";
  if (messages.length === 0) {
    _setChatEmptyState(true);
    return;
  }
  _setChatEmptyState(false);
  messages.forEach(msg => appendMessageToArea(msg.role === "user" ? "user" : "bot", msg.content));
  scrollToBottomOfChat();
}

function _setChatEmptyState(empty) {
  const emptyEl    = document.getElementById("chat-empty-state");
  const messagesEl = getChatMessagesArea();
  if (emptyEl)    emptyEl.style.display    = empty ? "flex" : "none";
  if (messagesEl) messagesEl.style.display = empty ? "none" : "flex";
}

function showEmptyChatState() {
  _setChatEmptyState(true);
}

window.handleQuickSuggestion = function(text) {
  const input = document.getElementById("chat-input-new") || elements.chatInput;
  if (input) { input.value = text; input.focus(); }
};

async function handleNewChatSession() {
  activeSessionId = null;
  activeSessionMessages = [];
  highlightActiveSession(null);
  showEmptyChatState();
  const input = document.getElementById("chat-input-new") || elements.chatInput;
  if (input) { input.value = ""; input.style.height = "auto"; input.focus(); }
}

async function handleDeleteSession(sessionId) {
  if (!confirm("Xóa cuộc trò chuyện này?")) return;
  try {
    const res = await fetch(`${BACKEND_API_URL}/ai/sessions/${sessionId}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${currentUser.token}` },
    });
    if (res.ok) {
      chatSessions = chatSessions.filter(s => s.id !== sessionId);
      if (activeSessionId === sessionId) {
        activeSessionId = null; activeSessionMessages = [];
        chatSessions.length > 0 ? await loadSessionMessages(chatSessions[0].id) : showEmptyChatState();
      }
      renderSessionsSidebar();
    }
  } catch { alert("Lỗi kết nối khi xóa."); }
}

// ── MESSAGES ──────────────────────────────────────────────

function formatAiText(text) {
  if (!text) return "";
  let f = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  f = f.replace(/\*(.*?)\*/g, "<em>$1</em>");
  f = f.replace(/^[\*\-]\s+(.*)$/gm, `<div style="padding-left:1em;margin:2px 0">• $1</div>`);
  f = f.replace(/\n/g, "<br>");
  return f;
}

function appendMessageToArea(sender, text) {
  const messagesArea = getChatMessagesArea();
  if (!messagesArea) return;
  _setChatEmptyState(false); // Ẩn empty state khi có tin nhắn
  const isUser = sender === "user";
  const div = document.createElement("div");
  div.style.cssText = `
    display:flex;gap:0.6rem;
    justify-content:${isUser ? "flex-end" : "flex-start"};
    align-items:flex-end;`;
  const content = isUser ? text : formatAiText(text);
  if (!isUser) {
    div.innerHTML = `
      <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,hsl(214 90% 52%),hsl(225 85% 60%));display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-bottom:2px">
        <span style="font-size:0.75rem">🤖</span>
      </div>
      <div style="
        max-width:72%;background:hsl(var(--muted));border:1px solid hsl(var(--border)/0.5);
        border-radius:16px 16px 16px 4px;padding:10px 14px;
        font-size:0.875rem;line-height:1.65;color:hsl(var(--foreground));
        box-shadow:0 1px 4px rgba(0,0,0,0.06)">${content}</div>`;
  } else {
    div.innerHTML = `
      <div style="
        max-width:72%;background:linear-gradient(135deg,hsl(214 90% 52%),hsl(225 85% 60%));
        border-radius:16px 16px 4px 16px;padding:10px 14px;
        font-size:0.875rem;line-height:1.65;color:white;
        box-shadow:0 2px 8px rgba(29,110,234,0.25)">${content}</div>`;
  }
  messagesArea.appendChild(div);
  scrollToBottomOfChat();
}

function appendTypingIndicator() {
  const messagesArea = getChatMessagesArea();
  if (!messagesArea) return null;
  const div = document.createElement("div");
  div.className = "typing-indicator-wrapper";
  div.style.cssText = "display:flex;gap:0.6rem;align-items:flex-end;";
  div.innerHTML = `
    <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,hsl(214 90% 52%),hsl(225 85% 60%));display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-bottom:2px">
      <span style="font-size:0.75rem">🤖</span>
    </div>
    <div style="background:hsl(var(--muted));border:1px solid hsl(var(--border)/0.5);border-radius:16px 16px 16px 4px;padding:12px 16px;display:flex;gap:5px;align-items:center;">
      <div style="width:7px;height:7px;border-radius:50%;background:hsl(var(--muted-foreground));animation:typing-bounce 1.2s infinite 0s"></div>
      <div style="width:7px;height:7px;border-radius:50%;background:hsl(var(--muted-foreground));animation:typing-bounce 1.2s infinite 0.2s"></div>
      <div style="width:7px;height:7px;border-radius:50%;background:hsl(var(--muted-foreground));animation:typing-bounce 1.2s infinite 0.4s"></div>
    </div>`;
  messagesArea.appendChild(div);
  // Inject animation if not present
  if (!document.getElementById("typing-keyframe")) {
    const style = document.createElement("style");
    style.id = "typing-keyframe";
    style.textContent = `@keyframes typing-bounce { 0%,80%,100%{transform:translateY(0);opacity:.5} 40%{transform:translateY(-5px);opacity:1} }`;
    document.head.appendChild(style);
  }
  scrollToBottomOfChat();
  return div;
}

// ── LEGACY CHAT HELPERS (compat) ───────────────────────────

function appendMessage(sender, text, shouldSave = true) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `chat-message ${sender}`;
  const displayContent = sender === "bot" ? formatAiText(text) : text;
  messageDiv.innerHTML = `<p>${displayContent}</p>`;
  if (elements.chatMessagesContainer)
    elements.chatMessagesContainer.appendChild(messageDiv);
  scrollToBottomOfChat();
}

async function handleClearChatHistory() {
  if (!currentUser) return;
  if (!confirm("Bạn có chắc muốn xóa toàn bộ lịch sử trò chuyện không?")) return;
  try {
    const res = await fetch(`${BACKEND_API_URL}/ai/history`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${currentUser.token}` },
    });
    if (res.ok) {
      activeSessionMessages = [];
      chatSessions = [];
      activeSessionId = null;
      chatLayoutRendered = false;
      await loadChatSessions();
      showEmptyChatState();
    } else {
      alert("Không thể xóa lịch sử. Vui lòng thử lại.");
    }
  } catch (e) {
    console.error("Lỗi xóa lịch sử chat:", e);
    alert("Lỗi kết nối server.");
  }
}

// ── SEND MESSAGE ──────────────────────────────────────────

async function handleSendMessage() {
  const chatInput = document.getElementById("chat-input-new") || elements.chatInput;
  if (!chatInput) return;
  const message = chatInput.value.trim();
  if (!message || !currentUser) return;

  // Clear input
  chatInput.value = ""; chatInput.style.height = "auto";

  // Append user message
  appendMessageToArea("user", message);
  activeSessionMessages.push({ role: "user", content: message });

  // Show typing
  const typingIndicator = appendTypingIndicator();

  // Prepare history (last 20 messages to avoid token limit)
  const historyForApi = activeSessionMessages.slice(-20).slice(0, -1).map(m => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  try {
    const sendBtn = document.getElementById("send-chat-btn-new") || elements.sendChatBtn;
    if (sendBtn) sendBtn.disabled = true;

    const res = await fetch(`${BACKEND_API_URL}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentUser.token}` },
      body: JSON.stringify({
        user_message: message,
        session_id: activeSessionId,
        history: historyForApi,
      }),
    });

    if (typingIndicator) typingIndicator.remove();

    if (res.ok) {
      const data = await res.json();
      const botResponse = data.response;
      const newSessionId = data.session_id;

      // Cập nhật session_id nếu là session mới
      const wasNewSession = !activeSessionId;
      if (newSessionId) activeSessionId = newSessionId;

      appendMessageToArea("bot", botResponse);
      activeSessionMessages.push({ role: "assistant", content: botResponse });

      // Nếu là session mới → refresh sidebar để hiện title mới
      if (wasNewSession) {
        await loadChatSessions();
      } else {
        // Cập nhật thời gian session hiện tại trong danh sách local
        const sessionIdx = chatSessions.findIndex(s => s.id === activeSessionId);
        if (sessionIdx !== -1) {
          chatSessions[sessionIdx].updated_at = new Date().toISOString();
          chatSessions[sessionIdx].message_count += 2;
          // Sort by updated_at
          chatSessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
          renderSessionsSidebar();
        }
      }
      highlightActiveSession(activeSessionId);
    } else {
      const errData = await res.json();
      appendMessageToArea("bot", `⚠️ Lỗi: ${errData.msg || "Không thể kết nối đến AI."}`);
    }
  } catch (e) {
    if (typingIndicator) typingIndicator.remove();
    appendMessageToArea("bot", "⚠️ Lỗi kết nối đến server. Vui lòng thử lại.");
    console.error("Chat error:", e);
  } finally {
    const sendBtn = document.getElementById("send-chat-btn-new") || elements.sendChatBtn;
    if (sendBtn) sendBtn.disabled = false;
    const input = document.getElementById("chat-input-new") || elements.chatInput;
    if (input) input.focus();
  }
}

// =========================================================
// REVIEW MODULE
// =========================================================
function resetReviewState() {
  if (reviewTimerInterval) clearInterval(reviewTimerInterval);
  reviewMode = null;
  reviewDeckId = null;
  reviewWordList = [];
  reviewTotalWordsPool = [];
  reviewCurrentIndex = 0;
  reviewScore = 0;
  reviewTotalQuestions = 0;
}

function populateReviewDeckSelect() {
  if (!elements.reviewDeckSelect) return;
  elements.reviewDeckSelect.innerHTML =
    '<option value="all">Tất cả các bộ từ</option>';
  decks.forEach((deck) => {
    const option = document.createElement("option");
    option.value = deck.id;
    option.textContent = deck.name;
    elements.reviewDeckSelect.appendChild(option);
  });
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function prepareReviewGame() {
  if (!elements.reviewDeckSelect || !elements.reviewCountSelect) return false;

  reviewDeckId = elements.reviewDeckSelect.value;
  const selectedCountValue = elements.reviewCountSelect.value;

  let pool = [];
  reviewTotalWordsPool = [];

  decks.forEach((deck) => {
    const wordsWithInfo = (deck.words || [])
      .filter((w) => w.word && w.meaning)
      .map((w) => ({ ...w, deckId: deck.id }));

    if (reviewDeckId === "all" || deck.id === reviewDeckId) {
      pool.push(...wordsWithInfo);
    }
    reviewTotalWordsPool.push(...wordsWithInfo);
  });

  if (pool.length < 1) {
    alert("Bộ từ này không có dữ liệu để ôn tập.");
    return false;
  }

  let targetCount = 0;
  if (selectedCountValue === "all") {
    targetCount = pool.length; // Lấy TẤT CẢ từ trong pool, không giới hạn
  } else {
    targetCount = Math.min(parseInt(selectedCountValue), pool.length); // Không vượt quá số từ có sẵn
  }

  // Shuffle pool một lần, không duplicate
  const shuffledPool = [...pool];
  shuffleArray(shuffledPool);
  reviewWordList = shuffledPool.slice(0, targetCount);
  reviewTotalQuestions = reviewWordList.length;
  reviewCurrentIndex = 0;
  reviewScore = 0;
  return true;
}

function handleStartReview(mode) {
  if (groupStudyMode && activeGroupDeck) {
    // Group study: dùng bộ từ nhóm trực tiếp
    const words = (activeGroupDeck.words || []).filter(w => w.word && w.meaning);
    if (words.length < 1) { alert("Bộ từ nhóm này không có dữ liệu để ôn tập."); return; }
    reviewMode = mode;
    reviewWordList = [...words].sort(() => Math.random() - 0.5);
    reviewTotalQuestions = reviewWordList.length;
    reviewTotalWordsPool = reviewWordList;
    reviewCurrentIndex = 0;
    reviewScore = 0;
  } else {
    if (decks.length === 0) { alert("Bạn chưa có bộ từ nào để ôn tập. Hãy tạo một bộ từ mới!"); return; }
    if (!prepareReviewGame()) return;
    reviewMode = mode;
  }

  elements.reviewSetup.classList.add("hidden");
  elements.reviewGameContainer.classList.remove("hidden");
  elements.reviewResultCard.classList.add("hidden");

  elements.gameTotalQ.textContent = reviewTotalQuestions;
  elements.gameScore.textContent = reviewScore;
  elements.feedbackSection.classList.add("hidden");

  elements.quizArea.classList.toggle("hidden", reviewMode !== "quiz" && reviewMode !== "en-vi");
  elements.fillArea.classList.toggle("hidden", reviewMode !== "fill");

  loadNextQuestion();
}

function loadNextQuestion() {
  if (reviewCurrentIndex >= reviewTotalQuestions) {
    showReviewResults();
    return;
  }

  const currentWord = reviewWordList[reviewCurrentIndex];
  elements.gameCurrentQ.textContent = reviewCurrentIndex + 1;
  elements.gameScore.textContent = reviewScore;
  elements.feedbackSection.classList.add("hidden");
  // Câu hỏi thay đổi theo mode
  if (reviewMode === "en-vi") {
    // Hỏi từ tiếng Anh → chọn nghĩa tiếng Việt
    elements.questionText.textContent = currentWord.word;
    const ipaHint = currentWord.ipa ? currentWord.ipa : '';
    elements.questionHint.textContent = ipaHint;
    if (ipaHint) elements.questionHint.classList.remove("hidden");
    else elements.questionHint.classList.add("hidden");
  } else {
    // Hỏi nghĩa tiếng Việt → chọn/điền từ tiếng Anh
    elements.questionText.textContent = currentWord.meaning;
    elements.questionHint.classList.add("hidden");
  }

  if (reviewMode === "quiz") renderQuizOptions(currentWord, false);
  else if (reviewMode === "en-vi") renderQuizOptions(currentWord, true);
  else if (reviewMode === "fill") setupFillInput(currentWord);

  reviewCurrentIndex++;
  startReviewTimer();
}

function renderQuizOptions(correctWord, enViMode = false) {
  elements.quizOptionsContainer.innerHTML = "";
  elements.quizArea.classList.remove("hidden");
  elements.fillArea.classList.add("hidden");

  // Lấy distractors từ pool
  let distractors = reviewTotalWordsPool.filter(w => w.word !== correctWord.word);
  shuffleArray(distractors);
  const finalDistractors = distractors.slice(0, 3);

  let options, correctAnswer;
  if (enViMode) {
    // Mode EN→VI: câu hỏi = từ EN, đáp án = nghĩa VI
    correctAnswer = correctWord.meaning;
    options = [...finalDistractors.map(w => w.meaning), correctWord.meaning];
  } else {
    // Mode VI→EN (quiz thường): câu hỏi = nghĩa VI, đáp án = từ EN
    correctAnswer = correctWord.word;
    options = [...finalDistractors.map(w => w.word), correctWord.word];
  }

  shuffleArray(options);

  options.forEach((option) => {
    const button = document.createElement("button");
    button.className = "btn btn-option";
    button.textContent = option;
    button.setAttribute("data-answer", option);
    button.setAttribute("data-correct", correctAnswer);
    button.addEventListener("click", handleQuizAnswer);
    elements.quizOptionsContainer.appendChild(button);
  });

  Array.from(elements.quizOptionsContainer.children).forEach(btn => btn.disabled = false);
}

function handleQuizAnswer(e) {
  const selectedBtn = e.target.closest(".btn-option");
  if (!selectedBtn) return;

  const correctWord = reviewWordList[reviewCurrentIndex - 1];
  // Lấy đáp án đúng từ data-correct (set bởi renderQuizOptions)
  const correctAnswer = selectedBtn.dataset.correct || correctWord.word;
  const selectedAnswer = selectedBtn.dataset.answer;
  const isCorrect = selectedAnswer === correctAnswer;

  Array.from(elements.quizOptionsContainer.children).forEach((btn) => {
    btn.disabled = true;
    if (btn.dataset.answer === correctAnswer) btn.classList.add("correct");
    else if (btn === selectedBtn && !isCorrect) btn.classList.add("wrong");
  });

  showFeedback(isCorrect, correctAnswer);
}

function setupFillInput(currentWord) {
  elements.fillInput.value = "";
  elements.fillInput.classList.remove("correct", "wrong");
  elements.fillInput.disabled = false;
  elements.submitFillBtn.disabled = false;
  elements.fillArea.classList.remove("hidden");
  elements.quizArea.classList.add("hidden");

  let hint = "";
  if (currentWord.ipa) hint += `/ ${currentWord.ipa} /`;
  elements.questionHint.textContent = hint;
  elements.questionHint.classList.remove("hidden");
  elements.fillInput.focus();
}

function handleFillAnswer() {
  const submittedAnswer = elements.fillInput.value.trim().toLowerCase();
  if (!submittedAnswer) return;

  const correctWord = reviewWordList[reviewCurrentIndex - 1];
  const correctAnswer = correctWord.word.toLowerCase();
  const isCorrect = submittedAnswer === correctAnswer;

  elements.fillInput.disabled = true;
  elements.submitFillBtn.disabled = true;
  elements.fillInput.classList.toggle("correct", isCorrect);
  elements.fillInput.classList.toggle("wrong", !isCorrect);

  showFeedback(isCorrect, correctWord.word);
}

function showFeedback(isCorrect, correctAnswer) {
  if (reviewTimerInterval) clearInterval(reviewTimerInterval);

  if (isCorrect) {
    reviewScore++;
    elements.gameScore.textContent = reviewScore;
    elements.feedbackMessage.textContent = "Chính xác! 🎉";
    elements.feedbackMessage.classList.remove("error");
    elements.feedbackMessage.classList.add("success");
    elements.feedbackDetail.textContent = "";
    if (currentUser) trackStudyActivity();
  } else {
    elements.feedbackMessage.textContent =
      timeLeft <= 0 ? "Hết giờ rồi! ⏰" : "Sai rồi. 😔";
    elements.feedbackMessage.classList.remove("success");
    elements.feedbackMessage.classList.add("error");
    elements.feedbackDetail.innerHTML = `Đáp án đúng là: <b lang="en" translate="no">${correctAnswer}</b>`;
  }
  elements.feedbackSection.classList.remove("hidden");
  elements.questionHint.classList.add("hidden");

  if (reviewMode === "fill") elements.nextQuestionBtn.focus();
}

function loadNextQuestionStep() {
  reviewCurrentIndex++;
  loadNextQuestion();
}

function startReviewTimer() {
  if (reviewTimerInterval) clearInterval(reviewTimerInterval);

  timeLeft = 15;
  if (elements.reviewTimerVal) {
    elements.reviewTimerVal.textContent = timeLeft;
    elements.reviewTimerVal.parentElement.style.color = "#ef4444";
  }

  reviewTimerInterval = setInterval(() => {
    timeLeft--;
    if (elements.reviewTimerVal) elements.reviewTimerVal.textContent = timeLeft;

    if (timeLeft <= 0) {
      clearInterval(reviewTimerInterval);
      handleReviewTimeout();
    }
  }, 1000);
}

function handleReviewTimeout() {
  const currentWord = reviewWordList[reviewCurrentIndex - 1];
  if (currentWord) {
    showFeedback(false, currentWord.word);
    if (reviewMode === "fill" && elements.fillInput) {
      elements.fillInput.disabled = true;
      elements.submitFillBtn.disabled = true;
    }
  }
}

function showReviewResults() {
  elements.reviewGameContainer.classList.add("hidden");
  elements.reviewSetup.classList.add("hidden");
  elements.reviewResultCard.classList.remove("hidden");

  const percentage = reviewTotalQuestions > 0
    ? Math.round((reviewScore / reviewTotalQuestions) * 100) : 0;
  const wrongCount = reviewTotalQuestions - reviewScore;

  if (elements.finalScore) elements.finalScore.textContent = `${reviewScore}/${reviewTotalQuestions}`;
  if (elements.finalPercent) elements.finalPercent.textContent = `${percentage}%`;
  const wrongEl = document.getElementById("final-wrong");
  if (wrongEl) wrongEl.textContent = wrongCount;

  // Animate score ring
  const ring = document.getElementById("result-ring-fill");
  if (ring) {
    const circumference = 314;
    const offset = circumference - (percentage / 100) * circumference;
    setTimeout(() => {
      ring.style.strokeDashoffset = offset;
      if (percentage >= 80) ring.style.stroke = "hsl(158 64% 42%)";
      else if (percentage >= 50) ring.style.stroke = "hsl(214 90% 52%)";
      else ring.style.stroke = "hsl(4 86% 56%)";
    }, 100);
  }

  // Message band
  const msgBand = document.getElementById("result-msg-band");
  const resultTitle = elements.reviewResultCard.querySelector("h2");
  if (percentage >= 90) {
    if (msgBand) { msgBand.textContent = "🔥 Xuất sắc! Bạn nắm vững kiến thức rồi!"; msgBand.style.background = "hsl(158 64% 42% / 0.12)"; msgBand.style.color = "hsl(158 64% 32%)"; }
    if (resultTitle) resultTitle.textContent = "Xuất Sắc! 🏆";
  } else if (percentage >= 70) {
    if (msgBand) { msgBand.textContent = "✨ Tốt lắm! Tiếp tục ôn luyện nhé!"; msgBand.style.background = "hsl(214 90% 52% / 0.1)"; msgBand.style.color = "hsl(214 90% 42%)"; }
    if (resultTitle) resultTitle.textContent = "Hoàn Thành! 🎉";
  } else if (percentage >= 50) {
    if (msgBand) { msgBand.textContent = "💪 Khá ổn! Ôn thêm một chút nữa nhé."; msgBand.style.background = "hsl(35 91% 55% / 0.1)"; msgBand.style.color = "hsl(35 91% 35%)"; }
    if (resultTitle) resultTitle.textContent = "Cố Lên Nhé! 💪";
  } else {
    if (msgBand) { msgBand.textContent = "📚 Cần ôn luyện thêm. Đừng nản lòng nhé!"; msgBand.style.background = "hsl(4 86% 56% / 0.1)"; msgBand.style.color = "hsl(4 86% 40%)"; }
    if (resultTitle) resultTitle.textContent = "Cần Cố Gắng Thêm!";
  }

  if (percentage >= 50) trackStudyActivity();
  resetReviewState();
}

// =========================================================
// LIBRARY SEARCH
// =========================================================
const librarySearch = document.getElementById("library-search");
if (librarySearch) {
  librarySearch.addEventListener("input", async (e) => {
    const term = e.target.value.toLowerCase().trim();
    const grid = document.getElementById("library-grid");
    if (!grid) return;
    const allCards = grid.querySelectorAll(".data-card");
    allCards.forEach(card => {
      const name = card.querySelector("h3")?.textContent?.toLowerCase() || "";
      card.style.display = name.includes(term) ? "flex" : "none";
    });
  });
}

// =========================================================
// DECK SELECTOR — COMPACT DROPDOWN
// =========================================================
let deckPanelOpen = false;

window.toggleDeckPanel = function() {
  deckPanelOpen = !deckPanelOpen;
  const panel   = document.getElementById('deck-dropdown-panel');
  const chevron = document.getElementById('deck-panel-chevron');
  if (panel)   panel.style.display    = deckPanelOpen ? '' : 'none';
  if (chevron) chevron.style.transform = deckPanelOpen ? 'rotate(180deg)' : '';
  if (deckPanelOpen) {
    const groupPanel = document.getElementById('deck-panel-group');
    if (groupPanel && groupPanel.style.display !== 'none') loadGroupDecksToSidebar();
  }
};

window.switchDeckTab = function(tab) {
  const mine    = document.getElementById('deck-panel-mine');
  const group   = document.getElementById('deck-panel-group');
  const btnMine = document.getElementById('tab-btn-mine');
  const btnGrp  = document.getElementById('tab-btn-group');
  if (tab === 'mine') {
    if (mine)    mine.style.display  = '';
    if (group)   group.style.display = 'none';
    if (btnMine) { btnMine.style.background = 'hsl(var(--primary))'; btnMine.style.color = '#fff'; }
    if (btnGrp)  { btnGrp.style.background  = 'transparent'; btnGrp.style.color = 'hsl(var(--muted-foreground))'; }
  } else {
    if (mine)    mine.style.display  = 'none';
    if (group)   group.style.display = '';
    if (btnMine) { btnMine.style.background = 'transparent'; btnMine.style.color = 'hsl(var(--muted-foreground))'; }
    if (btnGrp)  { btnGrp.style.background  = 'hsl(var(--primary))'; btnGrp.style.color = '#fff'; }
    loadGroupDecksToSidebar();
  }
};

function updateActiveDeckLabel() {
  const label = document.getElementById('active-deck-label');
  const icon  = document.getElementById('active-deck-icon');
  if (!label) return;
  if (!activeDeckId) { label.textContent = 'Chọn bộ từ...'; if (icon) icon.textContent = '📖'; return; }
  const deck = decks.find(d => d.id === activeDeckId);
  if (!deck) return;
  label.textContent = deck.name.replace(/^🏫\s?/, '');
  if (icon) icon.textContent = deck._isGroupDeck ? '🏫' : '📖';
}

async function loadGroupDecksToSidebar() {
  if (!currentUser || !currentUser.token) return;
  const list  = document.getElementById('group-deck-list');
  const empty = document.getElementById('group-deck-empty');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:0.8rem"><div style="width:18px;height:18px;border:2px solid hsl(var(--primary)/0.3);border-top-color:hsl(var(--primary));border-radius:50%;animation:spin 0.7s linear infinite;margin:auto"></div></div>';
  try {
    const res = await fetch(`${BACKEND_API_URL}/groups/my-decks`, {
      headers: { Authorization: `Bearer ${currentUser.token}` }
    });
    const data = await res.json();
    const groupDecks = data.decks || [];
    if (!groupDecks.length) {
      list.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    list.innerHTML = groupDecks.map(d => {
      const safe = JSON.stringify(d).replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$/g,'\\$');
      const safeAttr = JSON.stringify(d).replace(/"/g,'&quot;');
      return `<div onclick="handleLoadGroupDeck(this)"
        data-deck="${safeAttr}"
        style="padding:0.5rem 0.65rem;border-radius:8px;border:1px solid hsl(var(--border)/0.5);cursor:pointer;transition:background .15s;margin-bottom:0.3rem"
        onmouseover="this.style.background='hsl(var(--primary)/0.07)'"
        onmouseout="this.style.background='transparent'">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.3rem">
          <span style="font-weight:700;font-size:0.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">${d.name}</span>
          <div style="display:flex;gap:0.25rem;flex-shrink:0;align-items:center">
            <span style="font-size:0.67rem;background:hsl(var(--primary)/0.1);color:hsl(var(--primary));padding:1px 5px;border-radius:20px;font-weight:700">${(d.words||[]).length} từ</span>
            <button onclick="event.stopPropagation();openEditGroupDeck(this.closest('[data-deck]'))"
              style="font-size:0.65rem;padding:1px 5px;border:1px solid hsl(var(--border));border-radius:5px;background:transparent;cursor:pointer;color:hsl(var(--muted-foreground))" title="Sửa">✏️</button>
          </div>
        </div>
        <div style="font-size:0.68rem;color:hsl(var(--muted-foreground));margin-top:1px">🏫 ${d.group_name||''}</div>
      </div>`;
    }).join('');
  } catch {
    list.innerHTML = '<div style="font-size:0.78rem;color:hsl(var(--muted-foreground));padding:0.5rem">Không tải được</div>';
  }
}

window.handleLoadGroupDeck = async function(el) {
  let deck;
  try { deck = JSON.parse(el.getAttribute('data-deck')); } catch { return; }

  // Lưu vào state riêng, không động vào decks[] của tôi
  activeGroupDeck = {
    id: deck.id,
    name: deck.name,
    words: (deck.words || []).map((w, i) => ({
      id: w.id || `gw-${i}`,
      word: w.word, ipa: w.ipa || '', meaning: w.meaning,
      example: { en: w.example_en || '', vi: w.example_vi || '' }
    })),
    _isGroupDeck: true,
    _groupId: deck.group_id,
    _groupName: deck.group_name
  };
  groupStudyMode    = true;
  groupStudyDeck    = deck;
  groupStudyGroupId = deck.group_id;
  currentIndex = 0;
  isFlipped    = false;

  // Load progress nhóm từ server để biết từ nào đã học
  if (currentUser && deck.group_id && deck.id) {
    try {
      const res = await fetch(`${BACKEND_API_URL}/groups/${deck.group_id}/progress/${deck.id}`, {
        headers: { Authorization: `Bearer ${currentUser.token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const learnedIds = new Set((data.learned_words || []).map(w => w.word_id || w));
        progress[deck.id] = { learnedWords: learnedIds };
        // Tìm từ đầu tiên chưa học để bắt đầu
        const firstUnlearned = activeGroupDeck.words.findIndex(w => !learnedIds.has(w.id));
        currentIndex = firstUnlearned >= 0 ? firstUnlearned : 0;
      }
    } catch(e) { console.error('Không load được progress nhóm', e); }
  }

  // Cập nhật label ô selector
  const label = document.getElementById('active-deck-label');
  const icon  = document.getElementById('active-deck-icon');
  if (label) label.textContent = deck.name;
  if (icon)  icon.textContent  = '🏫';

  // Đóng dropdown, GIỮ nguyên tab Nhóm
  deckPanelOpen = false;
  const panel   = document.getElementById('deck-dropdown-panel');
  const chevron = document.getElementById('deck-panel-chevron');
  if (panel)   panel.style.display    = 'none';
  if (chevron) chevron.style.transform = '';

  switchView('dashboard');
  updateDisplay();
};

window.openEditGroupDeck = async function(el) {
  let deck;
  try { deck = JSON.parse(el.getAttribute('data-deck')); } catch { return; }
  editingDeckId = `GROUP:${deck.group_id}:${deck.id}`;
  document.getElementById('modal-title').textContent = `✏️ Sửa bộ từ nhóm: ${deck.name}`;
  document.getElementById('deck-name').value = deck.name || '';
  const container = document.getElementById('word-inputs-container');
  container.innerHTML = '';
  (deck.words || []).forEach(w => addWordInputField(w));
  const countEl = document.getElementById('word-count-in-modal');
  if (countEl) countEl.textContent = `${(deck.words||[]).length} từ`;
  const preview = document.getElementById('word-preview-container');
  if (preview) preview.classList.add('hidden');
  elements.deckModal.classList.remove('hidden');
};

// =========================================================
// START APP
// =========================================================
document.addEventListener("DOMContentLoaded", async () => {
  await init();

  // ── View Transition khi navigate sang group.html ──
  document.querySelectorAll('a[href*="group.html"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (!href || href.startsWith('http')) return; // external link, skip
      if (!document.startViewTransition) {
        // Browser không hỗ trợ → navigate bình thường
        return;
      }
      e.preventDefault();
      document.startViewTransition(() => {
        window.location.href = href;
      });
    });
  });
});
// =========================================================
// NOTIFICATION SYSTEM
// =========================================================
let _notifPollInterval = null;
const NOTIF_ICONS = {
  group_deleted:  '🗑️',
  group_joined:   '👥',
  broadcast:      '📢',
  maintenance:    '🔧',
  system:         '⚙️',
  default:        '🔔'
};

function getNotifIcon(type) {
  return NOTIF_ICONS[type] || NOTIF_ICONS.default;
}

function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'Vừa xong';
  if (m < 60)  return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  return `${d} ngày trước`;
}

function initNotifications() {
  fetchAndRenderNotifications();
  if (_notifPollInterval) clearInterval(_notifPollInterval);
  _notifPollInterval = setInterval(fetchAndRenderNotifications, 60000);

  // Click ngoài panel để đóng - đăng ký 1 lần
  if (!window._notifOutsideHandler) {
    window._notifOutsideHandler = function(e) {
      const wrap = document.getElementById('notif-bell-wrap');
      const panel = document.getElementById('notif-panel');
      if (wrap && panel && !wrap.contains(e.target)) {
        panel.style.display = 'none';
      }
    };
    document.addEventListener('click', window._notifOutsideHandler);
  }
}

async function fetchAndRenderNotifications() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${BACKEND_API_URL}/notifications?limit=30`, {
      headers: { Authorization: `Bearer ${currentUser.token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    updateNotifBadge(data.unread_count || 0);
    renderNotifList(data.notifications || []);
  } catch {}
}

function updateNotifBadge(count) {
  const bell  = document.getElementById('notif-bell-btn');
  const badge = document.getElementById('notif-badge');
  if (!bell || !badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.remove('hidden');
    bell.classList.add('has-unread');
  } else {
    badge.classList.add('hidden');
    bell.classList.remove('has-unread');
  }
  // Update mobile nav badge nếu có
  const mnavBadge = document.getElementById('mnav-notif-badge');
  if (mnavBadge) {
    mnavBadge.textContent = count > 0 ? (count > 99 ? '99+' : count) : '';
    mnavBadge.style.display = count > 0 ? 'flex' : 'none';
  }
}

function renderNotifList(notifs) {
  const list = document.getElementById('notif-list');
  if (!list) return;
  if (!notifs.length) {
    list.innerHTML = '<div class="notif-empty">Không có thông báo nào</div>';
    return;
  }
  list.innerHTML = notifs.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}" onclick="markNotifRead('${n.id}', this)">
      <div class="notif-icon">${getNotifIcon(n.type)}</div>
      <div class="notif-content">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-message">${escapeHtml(n.message)}</div>
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>
      <button class="notif-delete-btn" onclick="deleteNotif('${n.id}', event)" title="Xóa">✕</button>
    </div>
  `).join('');
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function markNotifRead(id, el) {
  if (!currentUser) return;
  if (el && el.classList.contains('unread')) {
    el.classList.remove('unread');
    el.querySelector('.notif-item')?.classList.remove('unread');
    // Update badge
    const badge = document.getElementById('notif-badge');
    if (badge) {
      const cur = parseInt(badge.textContent) || 0;
      if (cur > 1) badge.textContent = cur - 1;
      else { badge.classList.add('hidden'); document.getElementById('notif-bell-btn')?.classList.remove('has-unread'); }
    }
  }
  try {
    await fetch(`${BACKEND_API_URL}/notifications/read`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentUser.token}` },
      body: JSON.stringify({ id })
    });
  } catch {}
}

async function deleteNotif(id, e) {
  e.stopPropagation();
  if (!currentUser) return;
  const item = document.querySelector(`.notif-item[data-id="${id}"]`);
  if (item) item.remove();
  try {
    await fetch(`${BACKEND_API_URL}/notifications/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${currentUser.token}` }
    });
    fetchAndRenderNotifications(); // refresh badge
  } catch {}
}

// Toggle panel (gọi từ onclick inline trong HTML)
function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const isVisible = panel.style.display === 'flex';
  if (isVisible) {
    panel.style.display = 'none';
  } else {
    // Đảm bảo xóa class hidden nếu còn
    panel.classList.remove('hidden');
    panel.style.display = 'flex';
    fetchAndRenderNotifications();
  }
}

// Đánh dấu tất cả đã đọc (gọi từ onclick inline)
async function markAllNotifsRead() {
  if (!currentUser) return;
  try {
    await fetch(`${BACKEND_API_URL}/notifications/read`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentUser.token}` },
      body: JSON.stringify({})
    });
    fetchAndRenderNotifications();
  } catch {}
}

// Xóa tất cả (gọi từ onclick inline)
async function clearAllNotifs() {
  if (!currentUser) return;
  if (!confirm('Xóa tất cả thông báo?')) return;
  try {
    await fetch(`${BACKEND_API_URL}/notifications/clear`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${currentUser.token}` }
    });
    fetchAndRenderNotifications();
  } catch {}
}

// Check maintenance khi app load
async function checkMaintenance() {
  try {
    const res = await fetch(`${BACKEND_API_URL}/protected`, {
      headers: currentUser ? { Authorization: `Bearer ${currentUser.token}` } : {}
    });
    if (res.status === 503) {
      const data = await res.json();
      if (data.maintenance) showMaintenanceOverlay(data);
    }
  } catch {}
}

function showMaintenanceOverlay(data) {
  const msg = (typeof data === 'string') ? data : (data?.msg || 'Hệ thống đang bảo trì, vui lòng quay lại sau.');
  const eta = (typeof data === 'object') ? (data?.eta || '') : '';

  // Hiện overlay inline nếu có element
  const overlay = document.getElementById('maintenance-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    const msgEl = document.getElementById('maintenance-msg');
    const etaEl = document.getElementById('maintenance-eta');
    if (msgEl) msgEl.textContent = msg;
    if (etaEl) etaEl.textContent = eta ? `Dự kiến hoàn thành: ${eta}` : '';
    return;
  }

  // Redirect sang maintenance.html
  const params = new URLSearchParams({ msg, eta });
  window.location.href = `/maintenance.html?${params.toString()}`;
}
// =========================================================
// FAB DRAGGABLE
// =========================================================
(function initFabDraggable() {
  const fab = document.getElementById('open-chat-btn');
  if (!fab) return;
  let isDragging = false, startX, startY, origX, origY, moved = false;
  const DRAG_THRESHOLD = 5;

  function getPos() {
    const rect = fab.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }

  function setPos(x, y) {
    const W = window.innerWidth, H = window.innerHeight;
    const w = fab.offsetWidth, h = fab.offsetHeight;
    x = Math.max(8, Math.min(W - w - 8, x));
    y = Math.max(8, Math.min(H - h - 8, y));
    fab.style.left = x + 'px';
    fab.style.top = y + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  }

  fab.addEventListener('mousedown', startDrag);
  fab.addEventListener('touchstart', startDrag, { passive: true });

  function startDrag(e) {
    const touch = e.touches ? e.touches[0] : e;
    startX = touch.clientX; startY = touch.clientY;
    const pos = getPos();
    origX = pos.x; origY = pos.y;
    isDragging = true; moved = false;
    fab.style.transition = 'none';
    fab.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
  }

  function onDrag(e) {
    if (!isDragging) return;
    if (e.cancelable) e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    const dx = touch.clientX - startX, dy = touch.clientY - startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) moved = true;
    if (moved) setPos(origX + dx, origY + dy);
  }

  function endDrag(e) {
    isDragging = false;
    fab.style.cursor = '';
    fab.style.transition = '';
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('touchmove', onDrag);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchend', endDrag);
    // Nếu chỉ click (không kéo) → mở chat bình thường
    if (!moved) fab.click();
  }

  // Override click để tránh double-fire khi drag
  fab.addEventListener('click', (e) => {
    if (moved) { e.stopImmediatePropagation(); moved = false; }
  }, true);
})();



// =========================================================
// GROUP MODULE — Gộp từ group.html
// =========================================================
(function initGroupModule() {
  // Chỉ init khi đang ở group view
  let groupInitialized = false;

  // Thay thế API URL
  const GROUP_API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:5000/api'
    : 'https://backend-late-bird-6083.fly.dev/api';


  (() => {
    'use strict';

    // ── Config ────────────────────────────────────────────
    // API đã được định nghĩa là GROUP_API ở trên

    // ── State ─────────────────────────────────────────────
    let currentUser  = null;
    let myGroups     = [];
    let activeGroup  = null; // full group detail object
    let activeTab    = 'progress';

    // ── Auth helpers ──────────────────────────────────────
    function getToken() {
      return (currentUser && currentUser.token)
        || localStorage.getItem('vocabflow_authToken') || '';
    }

    function authHeaders(extra = {}) {
      return { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...extra };
    }

    async function apiFetch(path, opts = {}) {
      const { headers: extraHeaders, ...restOpts } = opts;
      const res = await fetch(GROUP_API + path, {
        headers: { ...authHeaders(), ...(extraHeaders || {}) },
        ...restOpts,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.msg || `HTTP ${res.status}`);
      return data;
    }

    // ── Toast ─────────────────────────────────────────────
    function toast(msg, type = 'default') {
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      el.textContent = msg;
      document.getElementById('toast-container').appendChild(el);
      setTimeout(() => el.remove(), 3000);
    }

    // ── Modal ─────────────────────────────────────────────
    function openModal(id) { const el=document.getElementById(id); if(el) el.classList.remove('hidden'); document.body.style.overflow='hidden'; }
    function closeModal(id) { const el=document.getElementById(id); if(el) el.classList.add('hidden'); document.body.style.overflow=''; }
    window.closeModal = closeModal;

    // ── Init ──────────────────────────────────────────────
    async function init() {
      console.log('[VocabFlow Group] init() called');
      const token = localStorage.getItem('vocabflow_authToken');
      const userData = localStorage.getItem('vocabflow_currentUser');
      console.log('[VocabFlow Group] token:', token ? 'EXISTS' : 'MISSING');
      console.log('[VocabFlow Group] userData:', userData ? 'EXISTS' : 'MISSING');

      if (!token || !userData) {
        console.log('[VocabFlow Group] → showing not-logged-in');
        document.getElementById('not-logged-in').classList.remove('hidden');
        return;
      }
      try {
        currentUser = JSON.parse(userData);
        currentUser.token = token;
        console.log('[VocabFlow Group] user:', currentUser.username);
      } catch(e) {
        console.error('[VocabFlow Group] parse error:', e);
        document.getElementById('not-logged-in').classList.remove('hidden');
        return;
      }

      document.getElementById('group-app').classList.remove('hidden');

      // Fetch avatar từ server (giống index.html)
      try {
        const meRes = await fetch(GROUP_API + '/user/me', {
          headers: { Authorization: `Bearer ${currentUser.token}` }
        });
        if (meRes.ok) {
          const meData = await meRes.json();
          if (meData.avatar_url) {
            const base = API.replace(/\/api$/, '');
            currentUser.avatar_url = base + meData.avatar_url + '?t=' + Date.now();
          }
        }
      } catch(e) {}

      // Cập nhật avatar giống index.html
      const avatarBtn  = document.getElementById('header-avatar-btn');
      const avatarImg  = document.getElementById('header-avatar-img');
      const avatarInit = document.getElementById('header-avatar-initials');
      const loginBtn   = document.getElementById('login-prompt-btn');
      if (avatarBtn)  avatarBtn.classList.remove('hidden');
      if (loginBtn)   loginBtn.style.display = 'none';
      if (currentUser.avatar_url && avatarImg) {
        avatarImg.src = currentUser.avatar_url;
        avatarImg.style.display = 'block';
        if (avatarInit) avatarInit.style.display = 'none';
      } else if (avatarInit) {
        const name = currentUser.username || currentUser.email || '?';
        avatarInit.textContent = name.charAt(0).toUpperCase();
        avatarInit.style.display = '';
      }

      console.log('[VocabFlow Group] → calling loadMyGroups()');
      loadMyGroups();
    }

    // ── Load groups ───────────────────────────────────────
    async function loadMyGroups() {
      document.getElementById('group-list').innerHTML = '<div style="text-align:center;padding:2rem"><div class="spinner"></div></div>';
      try {
        const data = await apiFetch('/groups');
        myGroups = data.groups || [];
        renderGroupList();
      } catch (e) {
        document.getElementById('group-list').innerHTML =
          `<div style="text-align:center;padding:1.5rem;color:hsl(var(--danger-color));font-size:0.85rem">${e.message}</div>`;
      }
    }

    function renderGroupList() {
      const el = document.getElementById('group-list');
      const drawerBody = document.getElementById('group-drawer-body');

      const groupHTML = !myGroups.length
        ? `<div class="empty-state" style="padding:1.5rem 0">
            <div class="empty-icon">📭</div>
            <p>Bạn chưa có nhóm nào.<br>Tạo hoặc tham gia nhóm để bắt đầu!</p>
          </div>`
        : myGroups.map(g => `
          <div class="group-card ${activeGroup && activeGroup.id === g.id ? 'active' : ''}"
            onclick="selectGroup('${g.id}')">
            ${g.is_owner ? `<span class="group-code-badge">${g.code}</span>` : ''}
            ${g.is_owner ? '<span class="group-owner-badge">Chủ nhóm</span>' : ''}
            <div class="group-card-name">${escHtml(g.name)}</div>
            <div class="group-card-meta">
              <span><i class="fa fa-users"></i>${g.member_count} người</span>
              <span><i class="fa fa-book"></i>${g.deck_count} bộ từ</span>
            </div>
          </div>
        `).join('');

      if (el) el.innerHTML = groupHTML;
      // Sync drawer content
      if (drawerBody) drawerBody.innerHTML = myGroups.length
        ? myGroups.map(g => `
          <div class="group-card ${activeGroup && activeGroup.id === g.id ? 'active' : ''}"
            onclick="selectGroup('${g.id}');closeGroupDrawer()">
            ${g.is_owner ? `<span class="group-code-badge">${g.code}</span>` : ''}
            ${g.is_owner ? '<span class="group-owner-badge">Chủ nhóm</span>' : ''}
            <div class="group-card-name">${escHtml(g.name)}</div>
            <div class="group-card-meta">
              <span><i class="fa fa-users"></i>${g.member_count} người</span>
              <span><i class="fa fa-book"></i>${g.deck_count} bộ từ</span>
            </div>
          </div>`).join('')
        : `<div style="text-align:center;padding:2rem 1rem;color:hsl(var(--muted-foreground));font-size:0.85rem">Chưa có nhóm nào</div>`;
    }

    // ── Navigate về index.html với đúng tab ───────────────
    window.navTo = function(view) {
      try { sessionStorage.setItem('vocabflow_view', view); } catch {}
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.sessionStorage.setItem('vocabflow_view', view);
          window.opener.focus();
          window.close();
          return false;
        } catch(e) {}
      }
      if (document.startViewTransition) {
        document.startViewTransition(() => { window.location.href = './index.html'; });
      } else {
        window.location.href = './index.html';
      }
      return false;
    };

    // ── Drawer open/close ─────────────────────────────────
    window.openGroupDrawer = function() {
      document.getElementById('group-drawer').classList.add('open');
      document.getElementById('group-drawer-overlay').classList.add('open');
      document.body.style.overflow = 'hidden';
    };
    window.closeGroupDrawer = function() {
      document.getElementById('group-drawer').classList.remove('open');
      document.getElementById('group-drawer-overlay').classList.remove('open');
      document.body.style.overflow = '';
    };

    // ── Select group ──────────────────────────────────────
    window.selectGroup = async function(gid) {
      document.getElementById('welcome-panel').classList.add('hidden');
      document.getElementById('group-detail').classList.remove('hidden');
      document.getElementById('progress-content').innerHTML = '<div class="spinner"></div>';
      document.getElementById('decks-content').innerHTML = '<div class="spinner"></div>';
      document.getElementById('members-content').innerHTML = '<div class="spinner"></div>';

      try {
        const data = await apiFetch(`/groups/${gid}`);
        activeGroup = data.group;
        renderGroupHeader();
        renderGroupList(); // re-render to show active
        switchTab(activeTab, null);
      } catch (e) { toast(e.message, 'error'); }
    };

    function renderGroupHeader() {
      const g = activeGroup;
      document.getElementById('detail-name').textContent    = g.name;
      document.getElementById('detail-desc').textContent    = g.description || '';
      document.getElementById('detail-code').textContent    = g.code;
      document.getElementById('detail-members').textContent = g.member_count;
      document.getElementById('detail-decks').textContent   = g.deck_count;
      document.getElementById('detail-created').textContent = g.created_at;

      // Owner-only controls
      document.getElementById('btn-create-deck').style.display  = g.is_owner ? '' : 'none';
      document.getElementById('danger-zone').style.display      = g.is_owner ? '' : 'none';
      document.getElementById('leave-zone').style.display       = g.is_owner ? 'none' : '';
      // Mã nhóm chỉ chủ nhóm thấy
      document.getElementById('group-code-section').style.display = g.is_owner ? '' : 'none';
    }

    // ── Tabs ──────────────────────────────────────────────
    window.switchTab = function(tab, btn) {
      activeTab = tab;
      ['progress','decks','members'].forEach(t => {
        document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab);
      });
      document.querySelectorAll('.group-tab').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      else document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');

      if (tab === 'progress') loadProgress();
      if (tab === 'decks')    renderDecks();
      if (tab === 'members')  renderMembers();
    };

    // ── Progress ──────────────────────────────────────────
    async function loadProgress() {
      if (!activeGroup) return;
      document.getElementById('progress-content').innerHTML = '<div class="spinner"></div>';
      try {
        const data = await apiFetch(`/groups/${activeGroup.id}/progress`);
        renderProgress(data.progress, data.my_id);
      } catch (e) {
        document.getElementById('progress-content').innerHTML =
          `<p style="color:hsl(var(--danger-color));font-size:0.85rem">${e.message}</p>`;
      }
    }

    function renderProgress(progressList, myId) {
      const el = document.getElementById('progress-content');
      if (!progressList || !progressList.length) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><h4>Chưa có tiến độ</h4><p>Khi thành viên bắt đầu học bộ từ nhóm, tiến độ sẽ xuất hiện ở đây.</p></div>`;
        return;
      }

      const rankIcon = i => {
        if (i === 0) return `<span class="rank-badge rank-1">🥇</span>`;
        if (i === 1) return `<span class="rank-badge rank-2">🥈</span>`;
        if (i === 2) return `<span class="rank-badge rank-3">🥉</span>`;
        return `<span class="rank-badge rank-n">${i+1}</span>`;
      };

      const barClass = pct => pct >= 70 ? 'good' : pct >= 40 ? 'warn' : 'poor';

      const rows = progressList.map((p, i) => {
        const isMe = p.user_id === myId;
        const barW = p.overall_pct;
        return `
          <tr style="${isMe ? 'background:hsl(var(--primary-muted))' : ''}">
            <td>${rankIcon(i)}</td>
            <td>
              <div style="font-weight:${isMe ? '800' : '600'};color:hsl(var(--foreground))">
                ${escHtml(p.username)} ${isMe ? '<span style="font-size:0.7rem;background:hsl(var(--primary));color:white;padding:0.1rem 0.4rem;border-radius:4px;margin-left:0.3rem">Bạn</span>' : ''}
              </div>
              ${p.role === 'owner' ? '<div style="font-size:0.72rem;color:hsl(var(--warning));font-weight:700">Chủ nhóm</div>' : ''}
            </td>
            <td>
              <div style="display:flex;align-items:center;gap:0.6rem">
                <div class="progress-bar-wrap">
                  <div class="progress-bar-fill ${barClass(barW)}" style="width:${barW}%"></div>
                </div>
                <span style="font-size:0.82rem;font-weight:700;min-width:36px">${barW}%</span>
              </div>
            </td>
            <td style="font-size:0.85rem;font-weight:600;color:hsl(var(--foreground))">${p.total_learned}/${p.total_words} từ</td>
          </tr>
        `;
      }).join('');

      el.innerHTML = `
        <table class="progress-table">
          <thead>
            <tr>
              <th style="width:42px">Hạng</th>
              <th>Học viên</th>
              <th>Tiến độ</th>
              <th>Từ đã học</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }

    // ── Decks ─────────────────────────────────────────────
    function renderDecks() {
      if (!activeGroup) return;
      const decks = activeGroup.decks || [];
      const el = document.getElementById('decks-content');

      if (!decks.length) {
        el.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📖</div>
            <h4>Chưa có bộ từ nào</h4>
            <p>${activeGroup.is_owner ? 'Bấm "Thêm bộ từ" để tạo bộ từ đầu tiên cho nhóm.' : 'Chủ nhóm chưa thêm bộ từ nào.'}</p>
            ${activeGroup.is_owner ? `<button class="btn btn-primary" onclick="openCreateDeck()"><i class="fa fa-plus"></i> Thêm bộ từ</button>` : ''}
          </div>`;
        return;
      }

      el.innerHTML = `<div class="deck-grid">${decks.map(d => `
        <div class="deck-item">
          <div class="deck-item-name">${escHtml(d.name)}</div>
          <div class="deck-item-meta"><i class="fa fa-layer-group"></i> ${d.words.length} từ &nbsp;·&nbsp; ${d.created_at}</div>
          <div class="deck-item-actions">
            <button class="btn btn-primary btn-sm" onclick='studyDeck(${JSON.stringify(d)})'>
              <i class="fa fa-play"></i> Học
            </button>
            ${activeGroup.is_owner ? `
              <button class="btn btn-outline btn-sm" onclick='openEditDeck(${JSON.stringify(d)})'>
                <i class="fa fa-edit"></i>
              </button>
              <button class="btn btn-sm" style="border:1px solid hsl(var(--danger-color));color:hsl(var(--danger-color));background:transparent;cursor:pointer;font-family:Nunito,sans-serif;font-size:0.78rem;font-weight:600;padding:0.3rem 0.6rem;border-radius:var(--radius)"
                onclick="confirmDeleteDeck('${d.id}','${escHtml(d.name)}')">
                <i class="fa fa-trash"></i>
              </button>` : ''}
          </div>
        </div>
      `).join('')}</div>`;
    }

    function renderMembers() {
      if (!activeGroup) return;
      const members = activeGroup.members || [];
      const el = document.getElementById('members-content');
      if (!members.length) {
        el.innerHTML = '<p style="color:hsl(var(--muted-foreground));font-size:0.85rem">Chưa có thành viên.</p>';
        return;
      }
      el.innerHTML = `<div class="member-list">${members.map(m => `
        <div class="member-item">
          <div class="member-avatar">${(m.username || '?')[0].toUpperCase()}</div>
          <div class="member-info">
            <div class="member-name">${escHtml(m.username)}</div>
            <div class="member-role ${m.role === 'owner' ? 'owner' : ''}">${m.role === 'owner' ? '👑 Chủ nhóm' : 'Thành viên'} · Tham gia ${m.joined_at}</div>
          </div>
          ${activeGroup.is_owner && m.role !== 'owner' ?
            `<button class="btn-kick" onclick="kickMember('${m.user_id}','${escHtml(m.username)}')">Xóa</button>` : ''}
        </div>
      `).join('')}</div>`;
    }

    // ── Study deck (redirect to main app) ────────────────────────
    window.studyDeck = function(deck) {
      // Lưu deck nhóm vào sessionStorage để index.html có thể tải
      sessionStorage.setItem('study_group_deck', JSON.stringify(deck));
      sessionStorage.setItem('study_group_id',   activeGroup.id);
      window.location.href = './index.html?mode=group_study';
    };

    // ── Create group ──────────────────────────────────────
    document.getElementById('btn-create-group').onclick = () => {
      document.getElementById('input-group-name').value = '';
      document.getElementById('input-group-desc').value = '';
      openModal('modal-create-group');
      setTimeout(() => document.getElementById('input-group-name').focus(), 100);
    };

    window.submitCreateGroup = async function() {
      const name = document.getElementById('input-group-name').value.trim();
      const desc = document.getElementById('input-group-desc').value.trim();
      if (!name) { toast('Vui lòng nhập tên nhóm', 'error'); return; }
      const btn = document.getElementById('btn-submit-create-group');
      btn.disabled = true; btn.textContent = 'Đang tạo...';
      try {
        const data = await apiFetch('/groups', {
          method: 'POST',
          body: JSON.stringify({ name, description: desc })
        });
        toast(`Tạo nhóm thành công! Mã: ${data.group.code}`, 'success');
        closeModal('modal-create-group');
        await loadMyGroups();
        selectGroup(data.group.id);
      } catch (e) { toast(e.message, 'error'); }
      finally { btn.disabled = false; btn.innerHTML = '<i class="fa fa-plus"></i> Tạo nhóm'; }
    };

    // ── Join group ────────────────────────────────────────
    document.getElementById('btn-join-group').onclick = () => {
      document.getElementById('input-join-code').value = '';
      openModal('modal-join-group');
      setTimeout(() => document.getElementById('input-join-code').focus(), 100);
    };

    window.submitJoinGroup = async function() {
      const code = document.getElementById('input-join-code').value.trim().toUpperCase();
      if (code.length < 4) { toast('Vui lòng nhập mã nhóm hợp lệ', 'error'); return; }
      try {
        const data = await apiFetch('/groups/join', {
          method: 'POST',
          body: JSON.stringify({ code })
        });
        toast(data.msg, 'success');
        closeModal('modal-join-group');
        await loadMyGroups();
        selectGroup(data.group.id);
      } catch (e) { toast(e.message, 'error'); }
    };

    // ── Copy code ─────────────────────────────────────────
    window.copyCode = function() {
      const code = document.getElementById('detail-code').textContent;
      navigator.clipboard.writeText(code).then(() => toast(`Đã sao chép mã: ${code}`, 'success'));
    };

    // ── Create deck ───────────────────────────────────────
    // ── AI Source toggle ─────────────────────────────────
    window.toggleGrpAiSource = function() {
      const v = document.getElementById('grp-ai-source').value;
      document.getElementById('grp-ai-text-area').style.display  = v === 'text' ? '' : 'none';
      document.getElementById('grp-ai-file-area').style.display  = v === 'file' ? '' : 'none';
    };

    // ── AI Analyze ────────────────────────────────────────
    window.runGrpAiAnalyze = async function() {
      const btn = document.getElementById('grp-analyze-btn');
      btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Đang phân tích...';
      try {
        const source = document.getElementById('grp-ai-source').value;
        let res;
        if (source === 'text') {
          const text = document.getElementById('grp-ai-text').value.trim();
          if (!text) { toast('Vui lòng nhập văn bản', 'error'); return; }
          res = await fetch(GROUP_API + '/ai/analyze_text', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ text })
          });
        } else {
          const file = document.getElementById('grp-ai-file').files[0];
          if (!file) { toast('Vui lòng chọn file', 'error'); return; }
          const fd = new FormData(); fd.append('file', file);
          const { 'Content-Type': _ct, ...hNoContentType } = authHeaders();
          res = await fetch(GROUP_API + '/ai/analyze_text', {
            method: 'POST', headers: hNoContentType, body: fd
          });
        }
        const data = await res.json();
        if (!res.ok) { toast(data.msg || 'Lỗi AI', 'error'); return; }
        const words = data.word_list || [];
        if (!words.length) { toast('Không tìm thấy từ vựng nào', 'error'); return; }
        renderGrpPreview(words);
      } catch(e) { toast('Lỗi kết nối: ' + e.message, 'error'); }
      finally { btn.disabled = false; btn.innerHTML = '<i class="fa fa-magic"></i> Phân Tích & Trích Xuất (AI)'; }
    };

    let grpPreviewWords = [];

    function renderGrpPreview(words) {
      grpPreviewWords = words;
      const body = document.getElementById('grp-preview-body');
      document.getElementById('grp-preview-count').textContent = `${words.length} từ`;
      document.getElementById('grp-select-all').checked = true;
      body.innerHTML = words.map((w, i) => `
        <tr style="border-top:1px solid hsl(var(--border)/0.4)">
          <td style="padding:5px 8px"><input type="checkbox" class="grp-word-cb" data-idx="${i}" checked></td>
          <td style="padding:5px 8px;font-weight:700">${escHtml(w.word||'')}</td>
          <td style="padding:5px 8px;font-size:0.78rem;color:hsl(var(--muted-foreground))">${escHtml(w.ipa||'')}</td>
          <td style="padding:5px 8px">${escHtml(w.meaning||'')}</td>
        </tr>`).join('');
      document.getElementById('grp-preview-wrap').style.display = '';
    }

    window.toggleAllGrpPreview = function(checked) {
      document.querySelectorAll('.grp-word-cb').forEach(cb => cb.checked = checked);
    };

    window.addSelectedGrpPreview = function() {
      document.querySelectorAll('.grp-word-cb:checked').forEach(cb => {
        const w = grpPreviewWords[parseInt(cb.dataset.idx)];
        if (w) addWordRow(w);
      });
      document.getElementById('grp-preview-wrap').style.display = 'none';
      updateGrpWordCount();
      toast(`Đã thêm từ vào danh sách!`, 'success');
    };

    window.addAllGrpPreview = function() {
      grpPreviewWords.forEach(w => addWordRow(w));
      document.getElementById('grp-preview-wrap').style.display = 'none';
      updateGrpWordCount();
      toast(`Đã thêm tất cả ${grpPreviewWords.length} từ!`, 'success');
    };

    function updateGrpWordCount() {
      const n = document.querySelectorAll('#deck-word-inputs .word-input-row').length;
      const el = document.getElementById('grp-word-count');
      if (el) el.textContent = `${n} từ`;
    }

    // ── Create deck ───────────────────────────────────────
    window.openCreateDeck = function() {
      document.getElementById('modal-deck-title').textContent = '➕ Tạo bộ từ nhóm';
      document.getElementById('input-deck-name').value = '';
      document.getElementById('editing-deck-id').value = '';
      document.getElementById('deck-word-inputs').innerHTML = '';
      document.getElementById('grp-ai-text').value = '';
      document.getElementById('grp-preview-wrap').style.display = 'none';
      updateGrpWordCount();
      addWordRow(); addWordRow(); addWordRow();
      updateGrpWordCount();
      openModal('modal-deck');
      setTimeout(() => document.getElementById('input-deck-name').focus(), 100);
    };

    document.getElementById('btn-create-deck').onclick = openCreateDeck;

    window.openEditDeck = function(deck) {
      document.getElementById('modal-deck-title').textContent = '✏️ Chỉnh sửa bộ từ';
      document.getElementById('input-deck-name').value = deck.name;
      document.getElementById('editing-deck-id').value = deck.id;
      document.getElementById('deck-word-inputs').innerHTML = '';
      document.getElementById('grp-ai-text').value = '';
      document.getElementById('grp-preview-wrap').style.display = 'none';
      (deck.words || []).forEach(w => addWordRow(w));
      if (!deck.words || !deck.words.length) addWordRow();
      updateGrpWordCount();
      openModal('modal-deck');
    };

    window.addWordRow = function(w = null) {
      const row = document.createElement('div');
      row.className = 'word-input-row';
      row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:0.4rem;align-items:center';
      row.innerHTML = `
        <input type="text" placeholder="Từ (VD: Serendipity)" value="${escHtml(w?.word || '')}" data-field="word"
          style="padding:6px 9px;border-radius:7px;border:1px solid hsl(var(--border)/0.6);font-size:0.82rem;background:hsl(var(--card)/0.8)"
          oninput="updateGrpWordCount()"/>
        <input type="text" placeholder="IPA (/ˌsɛr.../) " value="${escHtml(w?.ipa || '')}" data-field="ipa"
          style="padding:6px 9px;border-radius:7px;border:1px solid hsl(var(--border)/0.6);font-size:0.82rem;background:hsl(var(--card)/0.8)"/>
        <input type="text" placeholder="Nghĩa tiếng Việt" value="${escHtml(w?.meaning || '')}" data-field="meaning"
          style="padding:6px 9px;border-radius:7px;border:1px solid hsl(var(--border)/0.6);font-size:0.82rem;background:hsl(var(--card)/0.8)"/>
        <button onclick="this.closest('.word-input-row').remove();updateGrpWordCount()"
          style="width:26px;height:26px;border-radius:50%;border:none;background:hsl(var(--danger-color,0 84% 60%)/0.12);color:hsl(var(--danger-color,0 84% 60%));font-size:0.9rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0"
          title="Xóa">✕</button>
      `;
      document.getElementById('deck-word-inputs').appendChild(row);
      updateGrpWordCount();
    };

    window.submitDeck = async function() {
      if (!activeGroup) return;
      const name = document.getElementById('input-deck-name').value.trim();
      const did  = document.getElementById('editing-deck-id').value;
      if (!name) { toast('Vui lòng nhập tên bộ từ', 'error'); return; }

      const rows  = document.querySelectorAll('#deck-word-inputs .word-input-row');
      const words = [];
      rows.forEach((row, idx) => {
        const word    = row.querySelector('[data-field="word"]').value.trim();
        const ipa     = row.querySelector('[data-field="ipa"]').value.trim();
        const meaning = row.querySelector('[data-field="meaning"]').value.trim();
        if (word) words.push({ id: `w-${Date.now()}-${idx}`, word, ipa, meaning });
      });
      if (!words.length) { toast('Vui lòng thêm ít nhất 1 từ', 'error'); return; }

      const btn = document.querySelector('#modal-deck .btn-primary');
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Đang lưu...'; }
      try {
        if (did) {
          await apiFetch(`/groups/${activeGroup.id}/decks/${did}`, {
            method: 'PUT', body: JSON.stringify({ name, words })
          });
          toast('Đã cập nhật bộ từ!', 'success');
        } else {
          await apiFetch(`/groups/${activeGroup.id}/decks`, {
            method: 'POST', body: JSON.stringify({ name, words })
          });
          toast(`Đã tạo bộ từ với ${words.length} từ!`, 'success');
        }
        closeModal('modal-deck');
        const data = await apiFetch(`/groups/${activeGroup.id}`);
        activeGroup = data.group;
        renderGroupHeader();
        renderDecks();
      } catch (e) { toast(e.message, 'error'); }
      finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-save"></i> Lưu bộ từ'; } }
    };

    window.confirmDeleteDeck = function(did, dname) {
      if (!confirm(`Xóa bộ từ "${dname}" khỏi nhóm? Thao tác này không thể hoàn tác.`)) return;
      apiFetch(`/groups/${activeGroup.id}/decks/${did}`, { method: 'DELETE' })
        .then(async () => {
          toast('Đã xóa bộ từ', 'success');
          const data = await apiFetch(`/groups/${activeGroup.id}`);
          activeGroup = data.group;
          renderGroupHeader();
          renderDecks();
        })
        .catch(e => toast(e.message, 'error'));
    };

    // ── Kick member ───────────────────────────────────────
    window.kickMember = function(uid, uname) {
      if (!confirm(`Xóa "${uname}" khỏi nhóm?`)) return;
      apiFetch(`/groups/${activeGroup.id}/members/${uid}`, { method: 'DELETE' })
        .then(async () => {
          toast(`Đã xóa ${uname} khỏi nhóm`, 'success');
          const data = await apiFetch(`/groups/${activeGroup.id}`);
          activeGroup = data.group;
          renderGroupHeader();
          renderMembers();
        })
        .catch(e => toast(e.message, 'error'));
    };

    // ── Delete group ──────────────────────────────────────
    window.confirmDeleteGroup = function() {
      if (!confirm(`Giải tán nhóm "${activeGroup.name}"?\nToàn bộ bộ từ và tiến độ học sẽ bị xóa vĩnh viễn.`)) return;
      apiFetch(`/groups/${activeGroup.id}`, { method: 'DELETE' })
        .then(async () => {
          toast('Đã giải tán nhóm', 'success');
          activeGroup = null;
          document.getElementById('welcome-panel').classList.remove('hidden');
          document.getElementById('group-detail').classList.add('hidden');
          await loadMyGroups();
        })
        .catch(e => toast(e.message, 'error'));
    };

    // ── Leave group ───────────────────────────────────────
    window.confirmLeaveGroup = function() {
      if (!confirm(`Rời khỏi nhóm "${activeGroup.name}"?`)) return;
      apiFetch(`/groups/${activeGroup.id}/leave`, { method: 'POST' })
        .then(async () => {
          toast('Đã rời nhóm', 'success');
          activeGroup = null;
          document.getElementById('welcome-panel').classList.remove('hidden');
          document.getElementById('group-detail').classList.add('hidden');
          await loadMyGroups();
        })
        .catch(e => toast(e.message, 'error'));
    };

    // ── Utils ─────────────────────────────────────────────
    function escHtml(str) {
      return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // Expose ra window để initGroupView có thể gọi
    window._groupInit = init;
    window._groupLoadMyGroups = loadMyGroups;

  })();

  // Được gọi khi user bấm tab "Nhóm học"
  window.initGroupView = async function() {
    if (!groupInitialized) {
      groupInitialized = true;
      if (window._groupInit) await window._groupInit();
    } else {
      if (window._groupLoadMyGroups) window._groupLoadMyGroups();
    }
  };
})();