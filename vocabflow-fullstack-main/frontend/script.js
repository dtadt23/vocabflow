// --- START OF FILE script.js ---

// --- DEFAULT DATA (Dữ liệu mặc định - từ tiếng Anh và nghĩa tiếng Việt) ---
const defaultDecks = [
  {
    id: "deck-default-1", // Đổi ID mặc định để tránh trùng lặp với Date.now()
    name: "Từ Vựng Tiếng Anh Cơ Bản",
    words: [
      {
        id: "word-1-serendipity",
        word: "Serendipity",
        ipa: "/ˌsɛrənˈdɪpəti/",
        meaning: "Sự tình cờ may mắn",
        example: {
          en: "Finding that old book was pure serendipity.",
          vi: "Tìm thấy cuốn sách cũ đó là một sự tình cờ may mắn.",
        },
      },
      {
        id: "word-2-ephemeral",
        word: "Ephemeral",
        ipa: "/ɪˈfɛmərəl/",
        meaning: "Kéo dài rất ngắn",
        example: {
          en: "The beauty of cherry blossoms is ephemeral.",
          vi: "Vẻ đẹp của hoa anh đào thật phù du, chỉ kéo dài vài tuần.",
        },
      },
      {
        id: "word-3-ubiquitous",
        word: "Ubiquitous",
        ipa: "/juːˈbɪkwɪtəs/",
        meaning: "Phổ biến khắp mọi nơi",
        example: {
          en: "Smartphones have become ubiquitous in modern society.",
          vi: "Điện thoại thông minh đã trở nên phổ biến ở khắp mọi nơi trong xã hội hiện đại.",
        },
      },
      {
        id: "word-4-mellifluous",
        word: "Mellifluous",
        ipa: "/məˈlɪfluəs/",
        meaning: "Ngọt ngào hoặc du dương; dễ nghe",
        example: {
          en: "Her mellifluous voice captivated the entire audience.",
          vi: "Giọng hát du dương của cô ấy đã mê hoặc toàn bộ khán giả.",
        },
      },
      {
        id: "word-5-cogent",
        word: "Cogent",
        ipa: "/ˈkoʊdʒənt/",
        meaning: "Rõ ràng, hợp lý và thuyết phục",
        example: {
          en: "She presented a cogent argument for renewable energy.",
          vi: "Cô ấy đã trình bày một lập luận chặt chẽ cho năng lượng tái tạo.",
        },
      },
    ],
  },
];

// --- APPLICATION STATE (Trạng thái ứng dụng) ---
let decks = []; // Mảng chứa tất cả các bộ từ
let progress = {}; // Đối tượng chứa tiến độ của từng bộ từ { deckId: { learnedWords: Set<wordId> } }
let activeDeckId = null; // ID của bộ từ đang được học
let currentIndex = 0; // Chỉ số của từ hiện tại trong bộ từ
let isFlipped = false; // Trạng thái thẻ đang lật mặt sau hay mặt trước
let editingDeckId = null; // ID của bộ từ đang được chỉnh sửa trong modal (null nếu đang tạo mới)

// TRẠNG THÁI MỚI CHO NGƯỜI DÙNG
let currentUser = null; // Đối tượng người dùng đã đăng nhập { id, username, token, role }

let tesseractWorker = null; // Biến toàn cục cho Tesseract worker

// TRẠNG THÁI MỚI CHO VIEW
let currentView = "dashboard"; // Trạng thái view mặc định

// TRẠNG THÁI MỚI CHO CHAT
let chatHistory = []; // Lưu trữ lịch sử chat để gửi lại cho Backend (duy trì ngữ cảnh)
const INITIAL_BOT_MESSAGE =
  "Xin chào! Tôi là AI Coach của VocabFlow. Bạn muốn luyện tập về từ vựng hay ngữ pháp nào hôm nay?";

// --- DOM ELEMENTS (Các phần tử DOM) ---
const elements = {
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

  // Các phần tử cho chức năng OCR/FILE
  importImageBtn: document.getElementById("import-image-btn"),
  importPdfBtn: document.getElementById("import-pdf-btn"),
  imageUpload: document.getElementById("image-upload"),
  pdfUpload: document.getElementById("pdf-upload"),
  ocrStatus: document.getElementById("ocr-status"),
  ocrMessage: document.getElementById("ocr-message"),
  ocrProgress: document.getElementById("ocr-progress"),

  // CÁC PHẦN TỬ CHO CHỨC NĂNG ĐĂNG KÝ/ĐĂNG NHẬP
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

  // CÁC PHẦN TỬ CHO CHỨC NĂNG CHUYỂN VIEW
  navLinks: document.querySelectorAll(
    ".navigation .nav-link, .user-area .btn-ghost"
  ),
  dashboardView: document.getElementById("dashboard-view"),
  wordlistView: document.getElementById("wordlist-view"),
  progressView: document.getElementById("progress-view"),
  statisticsView: document.getElementById("statistics-view"),
  settingsView: document.getElementById("settings-view"),

  // CÁC PHẦN TỬ MỚI CHO CHỨC NĂNG CHATBOT
  openChatBtn: document.getElementById("open-chat-btn"),
  chatModal: document.getElementById("chat-modal"),
  closeChatModalBtn: document.getElementById("close-chat-modal-btn"),
  chatMessagesContainer: document.getElementById("chat-messages-container"),
  chatInput: document.getElementById("chat-input"),
  sendChatBtn: document.getElementById("send-chat-btn"),
};

// Cấu hình nút đăng xuất
elements.logoutBtn.className = "btn btn-outline";
elements.logoutBtn.innerHTML = `
    <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
    Đăng Xuất
`;

// --- DATA PERSISTENCE (Lưu trữ dữ liệu) ---
function saveDataToStorage() {
  const progressToSave = {};
  for (const deckId in progress) {
    if (progress[deckId] && progress[deckId].learnedWords) {
      progressToSave[deckId] = {
        learnedWords: Array.from(progress[deckId].learnedWords),
      };
    }
  }

  // Nếu có người dùng đăng nhập, dữ liệu sẽ được đồng bộ với backend qua API.
  // localStorage chỉ được sử dụng làm fallback cho người dùng không đăng nhập.
  if (!currentUser) {
    console.log("Chưa đăng nhập, lưu dữ liệu chung vào localStorage...");
    localStorage.setItem("vocabflow_decks", JSON.stringify(decks));
    localStorage.setItem("vocabflow_progress", JSON.stringify(progressToSave));
  }
}

async function loadDataFromStorage() {
  const storedToken = localStorage.getItem("vocabflow_authToken");
  const storedUser = localStorage.getItem("vocabflow_currentUser");

  if (storedToken && storedUser) {
    try {
      currentUser = JSON.parse(storedUser);
      currentUser.token = storedToken; // Gắn token vào đối tượng người dùng
      console.log(`Người dùng đã đăng nhập: ${currentUser.username}`);

      // Khi có người dùng đăng nhập, gọi API backend để tải dữ liệu
      try {
        const token = currentUser.token;

        // Tải bộ từ của người dùng
        const decksResponse = await fetch(`${BACKEND_API_URL}/decks`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (decksResponse.ok) {
          const decksData = await decksResponse.json();
          decks = decksData.decks;
        } else {
          console.error(
            "Failed to fetch user decks:",
            decksResponse.status,
            await decksResponse.text()
          );
          decks = [];
        }

        // Tải tiến độ học tập của người dùng
        const progressResponse = await fetch(`${BACKEND_API_URL}/progress`, {
          // Gọi API /api/progress mới
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (progressResponse.ok) {
          const progressData = await progressResponse.json();
          progress = {};
          for (const deckId in progressData.progress) {
            progress[deckId] = {
              learnedWords: new Set(progressData.progress[deckId].learnedWords),
            };
          }
        } else {
          console.error(
            "Failed to fetch user progress:",
            progressResponse.status,
            await progressResponse.text()
          );
          progress = {};
        }
      } catch (apiError) {
        console.error("Error fetching data from API:", apiError);
        currentUser = null; // Đặt lại nếu có lỗi API
        localStorage.removeItem("vocabflow_authToken");
        localStorage.removeItem("vocabflow_currentUser");
        alert("Không thể tải dữ liệu người dùng. Vui lòng đăng nhập lại.");
        // Fallback về dữ liệu chung (hoặc mặc định)
        const storedDecks = localStorage.getItem("vocabflow_decks");
        const storedProgress = localStorage.getItem("vocabflow_progress");
        decks =
          storedDecks && JSON.parse(storedDecks).length > 0
            ? JSON.parse(storedDecks)
            : [...defaultDecks];
        if (storedProgress) {
          const loadedProgress = JSON.parse(storedProgress);
          for (const deckId in loadedProgress) {
            progress[deckId] = {
              learnedWords: new Set(loadedProgress[deckId].learnedWords),
            };
          }
        } else {
          progress = {};
        }
      }
    } catch (e) {
      console.error("Lỗi khi tải thông tin người dùng hoặc dữ liệu riêng:", e);
      currentUser = null; // Đặt lại nếu có lỗi
      localStorage.removeItem("vocabflow_authToken");
      localStorage.removeItem("vocabflow_currentUser");
      // Fallback về dữ liệu chung
      const storedDecks = localStorage.getItem("vocabflow_decks");
      const storedProgress = localStorage.getItem("vocabflow_progress");
      decks =
        storedDecks && JSON.parse(storedDecks).length > 0
          ? JSON.parse(storedDecks)
          : [...defaultDecks]; // Sử dụng spread để tạo bản sao
      if (storedProgress) {
        const loadedProgress = JSON.parse(storedProgress);
        for (const deckId in loadedProgress) {
          progress[deckId] = {
            learnedWords: new Set(loadedProgress[deckId].learnedWords),
          };
        }
      } else {
        progress = {};
      }
    }
  } else {
    // Nếu không có người dùng đăng nhập, tải dữ liệu từ localStorage (hoặc mặc định)
    const storedDecks = localStorage.getItem("vocabflow_decks");
    const storedProgress = localStorage.getItem("vocabflow_progress");

    try {
      decks =
        storedDecks && JSON.parse(storedDecks).length > 0
          ? JSON.parse(storedDecks)
          : [...defaultDecks]; // Sử dụng spread để tạo bản sao
    } catch (e) {
      console.error(
        "Lỗi khi phân tích dữ liệu bộ từ đã lưu, đang tải dữ liệu mặc định:",
        e
      );
      decks = [...defaultDecks];
    }

    if (storedProgress) {
      try {
        const loadedProgress = JSON.parse(storedProgress);
        progress = {}; // Reset progress object before filling
        for (const deckId in loadedProgress) {
          progress[deckId] = {
            learnedWords: new Set(loadedProgress[deckId].learnedWords),
          };
        }
      } catch (e) {
        console.error(
          "Lỗi khi phân tích tiến độ đã lưu, đang đặt lại tiến độ:",
          e
        );
        progress = {}; // Đặt lại tiến độ nếu bị hỏng
      }
    } else {
      progress = {};
    }
  }

  // Đảm bảo có ít nhất một bộ từ mặc định nếu không có bộ từ nào được tải
  // và người dùng chưa đăng nhập.
  // Hoặc nếu đăng nhập nhưng không có deck nào, cũng sẽ hiển thị trạng thái trống
  if (decks.length === 0 && !currentUser) {
    decks = [...defaultDecks];
  } else if (decks.length > 0 && !activeDeckId) {
    // Tự động chọn bộ từ đầu tiên nếu có bộ từ và chưa có bộ nào được chọn
    activeDeckId = decks[0].id;
  }
}

// --- TESSERACT OCR LOGGER (Bộ ghi nhật ký OCR) ---
const tesseractLogger = (m) => {
  if (m.status === "recognizing text") {
    elements.ocrStatus.classList.remove("hidden");
    elements.ocrMessage.textContent = `Đang nhận dạng văn bản: ${Math.round(
      m.progress * 100
    )}%`;
    elements.ocrProgress.value = m.progress * 100;
  } else if (m.status === "loading tesseract core") {
    elements.ocrStatus.classList.remove("hidden");
    elements.ocrMessage.textContent = `Đang tải lõi OCR... ${Math.round(
      m.progress * 100
    )}%`;
    elements.ocrProgress.value = m.progress * 100;
  } else if (m.status === "loading language traineddata") {
    elements.ocrStatus.classList.remove("hidden");
    elements.ocrMessage.textContent = `Đang tải dữ liệu ngôn ngữ... ${Math.round(
      m.progress * 100
    )}%`;
    elements.ocrProgress.value = m.progress * 100;
  } else if (m.status === "initializing tesseract") {
    elements.ocrStatus.classList.remove("hidden");
    elements.ocrMessage.textContent = `Đang khởi tạo Tesseract... ${Math.round(
      m.progress * 100
    )}%`;
    elements.ocrProgress.value = m.progress * 100;
  } else if (m.status === "done") {
    elements.ocrMessage.textContent = "Nhận dạng hoàn tất.";
    elements.ocrProgress.value = 100;
    // Ẩn trạng thái sau khi hoàn tất một cách từ từ
    setTimeout(() => elements.ocrStatus.classList.add("hidden"), 2000);
  }
};

// --- INITIALIZATION (Khởi tạo) ---
async function init() {
  await loadDataFromStorage(); // Sử dụng await vì sau này có thể gọi API
  renderDeckList();
  updateAuthUI(); // Cập nhật UI dựa trên trạng thái đăng nhập
  setupEventListeners();

  // THÊM LOGIC CHUYỂN VIEW
  switchView(currentView);

  if (!activeDeckId || decks.length === 0) {
    showPlaceholder(); // Hiển thị placeholder ban đầu nếu chưa có deck nào được chọn hoặc decks trống
  } else {
    updateDisplay(); // Hiển thị nội dung học tập nếu có deck đang hoạt động
  }

  if (!("speechSynthesis" in window)) {
    elements.pronunciationBtn.disabled = true;
    elements.pronunciationBtn.title =
      "Trình duyệt của bạn không hỗ trợ chức năng phát âm.";
  }

  // Khởi tạo Tesseract worker một lần khi ứng dụng tải
  if (typeof Tesseract !== "undefined") {
    elements.ocrStatus.classList.remove("hidden");
    elements.ocrMessage.textContent = "Đang khởi tạo công cụ OCR...";
    elements.ocrProgress.value = 0;
    try {
      tesseractWorker = await Tesseract.createWorker("eng", 1, {
        logger: tesseractLogger,
      });
      await tesseractWorker.load();
      await tesseractWorker.loadLanguage("eng");
      await tesseractWorker.initialize("eng");
      elements.ocrMessage.textContent = "Công cụ OCR đã sẵn sàng.";
      elements.ocrProgress.value = 100;
      setTimeout(() => elements.ocrStatus.classList.add("hidden"), 1000);
      console.log("Tesseract worker đã sẵn sàng và được khởi tạo.");
    } catch (err) {
      console.error("Lỗi khi khởi tạo Tesseract worker:", err);
      elements.ocrMessage.textContent =
        "Lỗi khởi tạo OCR. Vui lòng tải lại trang.";
      elements.importImageBtn.disabled = true;
      elements.importPdfBtn.disabled = true;
      elements.importImageBtn.title = "Lỗi OCR";
      elements.importPdfBtn.title = "Lỗi OCR";
    }
  } else {
    console.error("Thư viện Tesseract.js không được tải.");
    elements.importImageBtn.disabled = true;
    elements.importPdfBtn.disabled = true;
    elements.importImageBtn.title = "Tesseract.js không khả dụng";
    elements.importPdfBtn.title = "Tesseract.js không khả dụng";
  }
}

// --- UI Rendering for Auth State ---
function updateAuthUI() {
  // Xóa nút đăng xuất cũ nếu có
  const existingLogoutBtn = elements.userArea.querySelector("#logout-btn"); // Thêm ID cho nút logout nếu muốn dễ chọn
  if (existingLogoutBtn) {
    existingLogoutBtn.remove();
  }

  if (currentUser) {
    // Người dùng đã đăng nhập
    elements.loginRegisterBtn.classList.add("hidden");
    elements.logoutBtn.id = "logout-btn"; // Gán ID để dễ xóa/thay thế
    elements.userArea.appendChild(elements.logoutBtn);
    elements.logoutBtn.addEventListener("click", handleLogout);
    elements.loginRegisterBtn.textContent = `Chào, ${
      currentUser.username.split("@")[0]
    }`;
    elements.loginRegisterBtn.classList.remove("hidden"); // Vẫn hiển thị tên người dùng nếu muốn
    elements.loginRegisterBtn.disabled = true; // Không cho click để đăng nhập nữa
    console.log(`Chào mừng, người dùng ${currentUser.username}!`);

    if (elements.openChatBtn) elements.openChatBtn.classList.remove("hidden"); // Hiển thị nút chat

    // Nếu đang ở view dashboard, kiểm tra lại xem có cần hiển thị progress/wordlist card không
    if (currentView === "dashboard" && activeDeckId) {
      elements.progressCard.classList.add("visible");
      elements.wordListCard.classList.add("visible");
    }
  } else {
    // Chưa đăng nhập
    elements.loginRegisterBtn.classList.remove("hidden");
    elements.loginRegisterBtn.textContent = "Đăng Nhập";
    elements.loginRegisterBtn.disabled = false;
    elements.loginRegisterBtn.onclick = openLoginModal; // Gán lại event listener

    if (elements.openChatBtn) elements.openChatBtn.classList.add("hidden"); // Ẩn nút chat
    elements.progressCard.classList.remove("visible");
    elements.wordListCard.classList.remove("visible");
  }
}

// --- UI RENDERING (Hiển thị giao diện) ---
function renderDeckList() {
  elements.deckList.innerHTML = "";
  if (decks.length === 0) {
    elements.deckList.innerHTML =
      '<p style="text-align: center; color: hsl(var(--muted-foreground));">Chưa có bộ từ nào. Hãy tạo một bộ!</p>';
    return;
  }
  decks.forEach((deck) => {
    const item = document.createElement("div");
    item.className = "deck-item";
    if (deck.id === activeDeckId) item.classList.add("active");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = deck.name;
    nameSpan.addEventListener("click", () => handleSelectDeck(deck.id));
    const actions = document.createElement("div");
    actions.className = "deck-item-actions";
    actions.innerHTML = `
            <button class="deck-action-btn edit-btn" title="Sửa Bộ Từ">
                <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
            </button>
            <button class="deck-action-btn delete-btn" title="Xóa Bộ Từ">
                <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>`;
    actions.querySelector(".edit-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      handleEditDeck(deck.id);
    });
    actions.querySelector(".delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      handleDeleteDeck(deck.id);
    });
    item.appendChild(nameSpan);
    item.appendChild(actions);
    elements.deckList.appendChild(item);
  });
}

function updateDisplay() {
  const activeDeck = decks.find((d) => d.id === activeDeckId);
  if (!activeDeck || activeDeck.words.length === 0) {
    showPlaceholder(true);
    return;
  }

  showLearningContent();
  const word = activeDeck.words[currentIndex];
  const deckProgress = progress[activeDeckId] || { learnedWords: new Set() };
  const total = activeDeck.words.length,
    learned = deckProgress.learnedWords.size;

  elements.wordText.textContent = word.word;
  elements.wordText.setAttribute("lang", "en");
  elements.wordText.setAttribute("translate", "no");

  elements.wordIpa.textContent = word.ipa || "";
  elements.wordIpa.setAttribute("lang", "en");
  elements.wordIpa.setAttribute("translate", "no");

  elements.meaningText.textContent = word.meaning;
  elements.meaningText.setAttribute("lang", "vi");
  elements.meaningText.setAttribute("translate", "no");

  elements.exampleBox.innerHTML = `
        <p class="example-text example-en" lang="en" translate="no">"${
          word.example?.en || ""
        }"</p>
        <p class="example-text example-vi" lang="vi" translate="no">"${
          word.example?.vi || ""
        }"</p>`;

  const sessionPerc =
    total > 0 ? Math.round(((currentIndex + 1) / total) * 100) : 0;
  const learnedPerc = total > 0 ? Math.round((learned / total) * 100) : 0;
  elements.sessionProgress.style.width = `${sessionPerc}%`;
  elements.learnedProgress.style.width = `${learnedPerc}%`;
  elements.sessionPercentage.textContent = `${sessionPerc}%`;
  elements.learnedPercentage.textContent = `${learnedPerc}%`;

  elements.currentWord.textContent = currentIndex + 1;
  elements.totalWords.textContent = total;
  elements.currentIndicator.textContent = currentIndex + 1;
  elements.totalIndicator.textContent = total;
  elements.reviewedCount.textContent = currentIndex + 1; // Số từ đã xem trong phiên
  elements.learnedCount.textContent = learned;
  elements.remainingCount.textContent = total - learned;
  elements.wordListBadge.textContent = `${total} từ`;

  elements.prevBtn.disabled = currentIndex === 0;
  elements.nextBtn.disabled = currentIndex === total - 1;
  elements.completionMessage.classList.toggle(
    "show",
    learned === total && total > 0
  );

  renderWordList();
  renderProgressDots();
}

function renderWordList() {
  const activeDeck = decks.find((d) => d.id === activeDeckId);
  if (!activeDeck) {
    elements.wordList.innerHTML =
      '<p style="text-align: center; color: hsl(var(--muted-foreground));">Hãy chọn một bộ từ.</p>';
    elements.wordListBadge.textContent = "0 từ";
    return;
  }
  const deckProgress = progress[activeDeckId] || { learnedWords: new Set() };
  elements.wordList.innerHTML = "";
  activeDeck.words.forEach((word, index) => {
    const item = document.createElement("div");
    item.className = "word-item";

    let status = "pending";
    if (deckProgress.learnedWords.has(word.id)) status = "learned";
    else if (index === currentIndex) status = "current";
    else if (index < currentIndex) status = "reviewed"; // Mark as reviewed if passed but not learned yet

    item.classList.add(status);

    let iconHtml = "";
    if (status === "learned") {
      iconHtml = `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
    } else if (status === "current") {
      iconHtml = `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/></svg>`;
    } else if (status === "reviewed") {
      iconHtml = `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>`; // Circle for reviewed
    } else {
      iconHtml = `<div class="status-pending" style="width: 1rem; height: 1rem; border-radius: 50%; border: 2px solid hsl(var(--muted-foreground) / 0.3);"></div>`;
    }

    item.innerHTML = `
            <div class="word-status-icon">${iconHtml}</div>
            <div class="word-content">
                <p class="word-title" lang="en" translate="no">${word.word}</p>
                <p class="word-meaning" lang="vi" translate="no">${
                  word.meaning
                }</p>
            </div>
            <span class="word-number">${index + 1}</span>`;
    item.addEventListener("click", () => {
      currentIndex = index;
      if (isFlipped) flipCard();
      updateDisplay();
    });
    elements.wordList.appendChild(item);
  });
}

function renderProgressDots() {
  const activeDeck = decks.find((d) => d.id === activeDeckId);
  if (!activeDeck) {
    elements.progressDots.innerHTML = "";
    return;
  }
  elements.progressDots.innerHTML = "";
  const deckProgress = progress[activeDeckId] || { learnedWords: new Set() };

  activeDeck.words.forEach((word, index) => {
    const dot = document.createElement("div");
    dot.className = "progress-dot";
    if (index === currentIndex) dot.classList.add("current");
    else if (deckProgress.learnedWords.has(word.id))
      dot.classList.add("completed");
    dot.addEventListener("click", () => {
      currentIndex = index;
      if (isFlipped) flipCard(); // Lật lại mặt trước nếu đang lật
      updateDisplay();
    });
    elements.progressDots.appendChild(dot);
  });
}

function showPlaceholder(isDeckEmpty = false) {
  elements.learningContent.classList.remove("visible");
  elements.placeholder.classList.remove("hidden");
  elements.progressCard.classList.remove("visible");
  elements.wordListCard.classList.remove("visible");
  elements.placeholder.innerHTML = isDeckEmpty
    ? `<h2>Bộ từ này trống.</h2><p>Vui lòng chỉnh sửa bộ từ để thêm một vài từ.</p>`
    : `<h2>Chào mừng đến với VocabFlow!</h2><p>Chọn một bộ từ để bắt đầu học, hoặc tạo một bộ từ mới.</p>`;
}
function showLearningContent() {
  elements.learningContent.classList.add("visible");
  elements.placeholder.classList.add("hidden");
  elements.progressCard.classList.add("visible");
  elements.wordListCard.classList.add("visible");
}

// --- UI NAVIGATION LOGIC (Logic Điều hướng UI) ---

function switchView(targetViewId) {
  // 1. Ẩn tất cả các views
  const allViews = document.querySelectorAll(".main-grid, .page-view");
  allViews.forEach((view) => view.classList.add("hidden"));

  // 2. Hiển thị view mục tiêu
  const targetElement = document.getElementById(targetViewId + "-view");
  if (targetViewId === "dashboard") {
    elements.dashboardView.classList.remove("hidden");
  } else if (targetElement) {
    targetElement.classList.remove("hidden");
  } else {
    console.error(`Không tìm thấy view với ID: ${targetViewId}-view`);
    return;
  }

  currentView = targetViewId;
  console.log(`Chuyển sang view: ${currentView}`);

  // 3. Cập nhật trạng thái Active trên Navigation
  elements.navLinks.forEach((link) => {
    link.classList.remove("active");
    const linkTarget = link.getAttribute("data-view-target");

    if (linkTarget === targetViewId) {
      // Đối với nav-link
      if (link.classList.contains("nav-link")) {
        link.classList.add("active");
      }
    }
  });

  // 4. Quản lý hiển thị Sidebar Cards
  if (currentView !== "dashboard") {
    elements.progressCard.classList.remove("visible");
    elements.wordListCard.classList.remove("visible");
  } else {
    // Chỉ hiện khi quay về Dashboard và có Deck đang hoạt động
    if (activeDeckId) {
      elements.progressCard.classList.add("visible");
      elements.wordListCard.classList.add("visible");
    }
  }
}

// --- EVENT LISTENERS & HANDLERS (Bộ lắng nghe sự kiện & Xử lý) ---
function setupEventListeners() {
  // Quản lý bộ từ
  if (elements.createDeckBtn)
    elements.createDeckBtn.addEventListener("click", handleOpenDeckModal);
  if (elements.closeDeckModalBtn)
    elements.closeDeckModalBtn.addEventListener("click", handleCloseDeckModal);
  if (elements.cancelDeckModalBtn)
    elements.cancelDeckModalBtn.addEventListener("click", handleCloseDeckModal);
  if (elements.saveDeckBtn)
    elements.saveDeckBtn.addEventListener("click", handleSaveDeck);
  if (elements.addWordFieldBtn)
    elements.addWordFieldBtn.addEventListener("click", () =>
      addWordInputField()
    );

  // Xử lý OCR/File upload
  if (elements.importImageBtn)
    elements.importImageBtn.addEventListener("click", () => {
      if (tesseractWorker) elements.imageUpload.click();
      else alert("Công cụ OCR chưa sẵn sàng. Vui lòng thử lại sau.");
    });
  if (elements.imageUpload)
    elements.imageUpload.addEventListener("change", (e) =>
      handleFileUpload(e.target.files[0], "image")
    );
  if (elements.importPdfBtn)
    elements.importPdfBtn.addEventListener("click", () => {
      if (tesseractWorker) elements.pdfUpload.click();
      else alert("Công cụ OCR chưa sẵn sàng. Vui lòng thử lại sau.");
    });
  if (elements.pdfUpload)
    elements.pdfUpload.addEventListener("change", (e) =>
      handleFileUpload(e.target.files[0], "pdf")
    );

  // Thẻ từ & Hành động
  if (elements.flashcard)
    elements.flashcard.addEventListener("click", (e) => {
      // Chỉ lật thẻ nếu không nhấp vào nút phát âm hoặc các nút hành động
      if (
        !e.target.closest(".pronunciation-btn") &&
        !e.target.closest(".action-buttons") &&
        !e.target.closest(".navigation-controls")
      ) {
        flipCard();
      }
    });
  if (elements.pronunciationBtn)
    elements.pronunciationBtn.addEventListener("click", handlePronunciation);
  if (elements.learnedBtn)
    elements.learnedBtn.addEventListener("click", () =>
      handleMarkWord("learned")
    );
  if (elements.reviewBtn)
    elements.reviewBtn.addEventListener("click", () =>
      handleMarkWord("review")
    );
  if (elements.flipBackBtn)
    elements.flipBackBtn.addEventListener("click", flipCard);
  if (elements.prevBtn)
    elements.prevBtn.addEventListener("click", handlePrevious);
  if (elements.nextBtn) elements.nextBtn.addEventListener("click", handleNext);
  if (elements.shuffleBtn)
    elements.shuffleBtn.addEventListener("click", handleShuffle);
  if (elements.resetBtn)
    elements.resetBtn.addEventListener("click", handleReset);
  document.addEventListener("keydown", handleKeyPress);

  // CÁC EVENT LISTENER CHO CHỨC NĂNG ĐĂNG KÝ/ĐĂNG NHẬP
  if (elements.loginRegisterBtn)
    elements.loginRegisterBtn.addEventListener("click", openLoginModal);

  if (elements.closeRegisterModalBtn)
    elements.closeRegisterModalBtn.addEventListener(
      "click",
      closeRegisterModal
    );
  if (elements.closeLoginModalBtn)
    elements.closeLoginModalBtn.addEventListener("click", closeLoginModal);

  if (elements.registerEmailBtn)
    elements.registerEmailBtn.addEventListener("click", handleRegisterEmail);
  if (elements.loginEmailBtn)
    elements.loginEmailBtn.addEventListener("click", handleLoginEmail);

  if (elements.registerFacebookBtn)
    elements.registerFacebookBtn.addEventListener(
      "click",
      handleRegisterFacebook
    );
  if (elements.loginFacebookBtn)
    elements.loginFacebookBtn.addEventListener("click", handleLoginFacebook);

  if (elements.openLoginFromRegister)
    elements.openLoginFromRegister.addEventListener("click", (e) => {
      e.preventDefault();
      closeRegisterModal();
      openLoginModal();
    });
  if (elements.openRegisterFromLogin)
    elements.openRegisterFromLogin.addEventListener("click", (e) => {
      e.preventDefault();
      closeLoginModal();
      openRegisterModal();
    });

  // THÊM EVENT LISTENER CHO CHUYỂN VIEW
  elements.navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const target = link.getAttribute("data-view-target");
      if (target) {
        switchView(target);
      }
    });
  });

  // CHAT BOT LISTENERS MỚI
  if (elements.openChatBtn)
    elements.openChatBtn.addEventListener("click", openChatModal);
  if (elements.closeChatModalBtn)
    elements.closeChatModalBtn.addEventListener("click", closeChatModal);

  // Đóng modal chat khi click vào overlay (nếu id của target là id của modal)
  if (elements.chatModal)
    elements.chatModal.addEventListener("click", (e) => {
      if (e.target.id === "chat-modal") {
        // Giả sử modal-overlay có ID="chat-modal"
        closeChatModal();
      }
    });

  if (elements.sendChatBtn)
    elements.sendChatBtn.addEventListener("click", handleSendMessage);
  if (elements.chatInput) {
    elements.chatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });

    // Tự động điều chỉnh chiều cao textarea (cho UX tốt hơn)
    elements.chatInput.addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = this.scrollHeight + "px";
    });
  }
}

// --- DECK MANAGEMENT HANDLERS (Xử lý quản lý bộ từ) ---
function handleSelectDeck(deckId) {
  if (activeDeckId === deckId) return; // Không làm gì nếu chọn lại bộ từ hiện tại

  activeDeckId = deckId;
  currentIndex = 0; // Luôn bắt đầu từ từ đầu tiên khi chọn bộ từ mới
  isFlipped = false; // Đặt lại trạng thái lật
  elements.flashcard.classList.remove("flipped");
  elements.actionButtons.classList.remove("show"); // Ẩn nút hành động khi chuyển từ
  updateDisplay();
  renderDeckList(); // Cập nhật trạng thái 'active' cho bộ từ
}

function handleOpenDeckModal() {
  editingDeckId = null;
  elements.modalTitle.textContent = "Tạo Bộ Từ Mới";
  elements.deckNameInput.value = "";
  elements.wordInputsContainer.innerHTML = "";
  addWordInputField();
  addWordInputField();
  addWordInputField();
  elements.ocrStatus.classList.add("hidden");
  elements.deckModal.classList.remove("hidden");
}

function handleEditDeck(deckId) {
  editingDeckId = deckId;
  const deck = decks.find((d) => d.id === deckId);
  if (!deck) return;

  elements.modalTitle.textContent = "Sửa Bộ Từ";
  elements.deckNameInput.value = deck.name;
  elements.wordInputsContainer.innerHTML = "";
  deck.words.forEach((word) => addWordInputField(word));
  addWordInputField(); // Thêm một trường trống cuối cùng để dễ dàng thêm từ mới
  elements.ocrStatus.classList.add("hidden");
  elements.deckModal.classList.remove("hidden");
}

async function handleDeleteDeck(deckId) {
  if (
    !confirm(
      "Bạn có chắc chắn muốn xóa bộ từ này không? Tất cả tiến độ học tập liên quan cũng sẽ bị mất."
    )
  ) {
    return;
  }

  if (currentUser) {
    try {
      const response = await fetch(`${BACKEND_API_URL}/decks/${deckId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${currentUser.token}`,
        },
      });

      const data = await response.json();
      if (response.ok) {
        alert(data.msg || "Bộ từ đã được xóa thành công trên server.");
        await loadDataFromStorage(); // Tải lại dữ liệu từ server
        // Sau khi xóa, nếu bộ từ đang hoạt động bị xóa, chọn lại bộ từ khác
        if (activeDeckId === deckId) {
          activeDeckId = decks.length > 0 ? decks[0].id : null;
        }
        renderDeckList();
        updateDisplay();
      } else {
        alert(`Lỗi khi xóa bộ từ: ${data.msg || "Không xác định"}`);
      }
    } catch (error) {
      console.error("Lỗi mạng khi xóa bộ từ:", error);
      alert("Không thể kết nối đến server để xóa bộ từ. Vui lòng thử lại.");
    }
  } else {
    // Xử lý xóa cục bộ nếu không có người dùng đăng nhập
    decks = decks.filter((d) => d.id !== deckId);
    if (progress[deckId]) {
      delete progress[deckId]; // Xóa tiến độ liên quan
    }
    saveDataToStorage();

    if (activeDeckId === deckId) {
      activeDeckId = decks.length > 0 ? decks[0].id : null;
    }
    renderDeckList();
    updateDisplay();
    alert("Bộ từ đã được xóa cục bộ.");
  }
}

function handleCloseDeckModal() {
  elements.deckModal.classList.add("hidden");
}

// Hàm thêm trường nhập liệu cho một từ (có thể điền sẵn dữ liệu)
function addWordInputField(
  word = { word: "", ipa: "", meaning: "", example: { en: "", vi: "" } }
) {
  const group = document.createElement("div");
  group.className = "word-input-group";
  // Nếu đang sửa/tải lại từ có ID, giữ lại ID để đánh dấu tiến độ
  const wordId =
    word.id ||
    `word-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  group.innerHTML = `
        <input type="hidden" class="word-id-input" value="${wordId}">
        <div class="word-input-field">
            <label for="word-input-${wordId}">Từ</label>
            <input type="text" id="word-input-${wordId}" placeholder="Từ tiếng Anh" class="word-input" value="${
    word.word
  }" lang="en" translate="no">
            <label for="ipa-input-${wordId}">Phiên âm IPA</label>
            <input type="text" id="ipa-input-${wordId}" placeholder="/fəˈnɛtɪk/" class="ipa-input" value="${
    word.ipa || ""
  }" lang="en" translate="no">
        </div>
        <div class="word-input-field">
            <label for="meaning-input-${wordId}">Nghĩa</label>
            <input type="text" id="meaning-input-${wordId}" placeholder="Nghĩa của từ" class="meaning-input" value="${
    word.meaning
  }" lang="vi" translate="no">
        </div>
        <div class="word-input-field">
            <label for="example-en-input-${wordId}">Ví dụ (Anh)</label>
            <input type="text" id="example-en-input-${wordId}" placeholder="Câu ví dụ tiếng Anh" class="example-en-input" value="${
    word.example?.en || ""
  }" lang="en" translate="no">
            <label for="example-vi-input-${wordId}">Ví dụ (Việt)</label>
            <input type="text" id="example-vi-input-${wordId}" placeholder="Bản dịch ví dụ tiếng Việt" class="example-vi-input" value="${
    word.example?.vi || ""
  }" lang="vi" translate="no">
        </div>
        <button class="remove-word-btn" title="Xóa Từ">&times;</button>`;
  group
    .querySelector(".remove-word-btn")
    .addEventListener("click", () => group.remove());
  elements.wordInputsContainer.appendChild(group);
}

async function handleSaveDeck() {
  const name = elements.deckNameInput.value.trim();
  if (!name) {
    alert("Tên bộ từ là bắt buộc.");
    return;
  }

  const words = Array.from(
    elements.wordInputsContainer.querySelectorAll(".word-input-group")
  )
    .map((g) => ({
      // Giữ lại ID có sẵn, hoặc tạo ID mới nếu là từ mới được thêm vào
      id: g.querySelector(".word-id-input").value,
      word: g.querySelector(".word-input").value.trim(),
      ipa: g.querySelector(".ipa-input").value.trim(),
      meaning: g.querySelector(".meaning-input").value.trim(),
      example: {
        en: g.querySelector(".example-en-input").value.trim(),
        vi: g.querySelector(".example-vi-input").value.trim(),
      },
    }))
    .filter((w) => w.word && w.meaning);

  if (words.length === 0) {
    alert("Vui lòng thêm ít nhất một từ với nghĩa của nó vào bộ từ.");
    return;
  }

  const deckData = { name, words };
  let method = "POST";
  let url = `${BACKEND_API_URL}/decks`;
  if (editingDeckId) {
    method = "PUT";
    url = `${BACKEND_API_URL}/decks/${editingDeckId}`;
  }

  if (currentUser) {
    try {
      const response = await fetch(url, {
        method: method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentUser.token}`,
        },
        body: JSON.stringify(deckData),
      });

      const data = await response.json();
      if (response.ok) {
        alert(data.msg || "Bộ từ đã được lưu thành công trên server!");
        // Sau khi lưu trên server, tải lại dữ liệu để đồng bộ UI
        await loadDataFromStorage();
        renderDeckList();
        handleCloseDeckModal();
        if (editingDeckId === activeDeckId) {
          currentIndex = 0;
          isFlipped = false;
          elements.flashcard.classList.remove("flipped");
          elements.actionButtons.classList.remove("show");
          updateDisplay();
        } else if (!activeDeckId && decks.length > 0) {
          handleSelectDeck(decks[0].id);
        }
        editingDeckId = null;
        return; // Thoát khỏi hàm sau khi xử lý API
      } else {
        alert(`Lỗi khi lưu bộ từ: ${data.msg || "Không xác định"}`);
      }
    } catch (error) {
      console.error("Lỗi mạng khi lưu bộ từ:", error);
      alert("Không thể kết nối đến server để lưu bộ từ. Vui lòng thử lại.");
    }
  }

  // Fallback hoặc xử lý khi không có người dùng đăng nhập hoặc lỗi API
  if (editingDeckId) {
    const deckIndex = decks.findIndex((d) => d.id === editingDeckId);
    if (deckIndex > -1) {
      decks[deckIndex] = { ...decks[deckIndex], name, words };
    }
  } else {
    decks.push({ id: `deck-${Date.now()}`, name, words });
  }

  saveDataToStorage(); // Lưu cục bộ nếu không có người dùng hoặc lỗi server
  renderDeckList();
  handleCloseDeckModal();
  if (editingDeckId === activeDeckId) {
    currentIndex = 0;
    isFlipped = false;
    elements.flashcard.classList.remove("flipped");
    elements.actionButtons.classList.remove("show");
    updateDisplay();
  } else if (!activeDeckId && decks.length > 0) {
    handleSelectDeck(decks[0].id);
  }
  editingDeckId = null;
}

// --- OCR/FILE PROCESSING FUNCTIONS (Các hàm xử lý OCR/file) ---
async function handleFileUpload(file, type) {
  if (!file) return;

  elements.ocrStatus.classList.remove("hidden");
  elements.ocrMessage.textContent = `Đang tải tệp...`;
  elements.ocrProgress.value = 0;

  try {
    let textContent = "";

    if (type === "image") {
      textContent = await recognizeTextFromImage(file);
    } else if (type === "pdf") {
      textContent = await recognizeTextFromPdf(file);
    }

    // Xóa tất cả các trường nhập liệu cũ và thêm kết quả OCR
    elements.wordInputsContainer.innerHTML = "";

    // Tesseract chỉ nhận dạng toàn bộ văn bản. Chúng ta cần một cơ chế để tách từ.
    // Đây là một cách đơn giản: tách văn bản thành các dòng, sau đó tìm các từ.
    const lines = textContent
      .split("\n")
      .filter((line) => line.trim().length > 0);
    let wordsAddedCount = 0;

    for (const line of lines) {
      // Tách các từ trong dòng, lọc các từ không phải chữ cái và quá ngắn
      const lineWords = line
        .split(/\s+/)
        .filter((word) => word.length > 2 && word.match(/^[a-zA-Z']+$/));

      if (lineWords.length > 0) {
        // Giả định từ đầu tiên của dòng là từ cần học, và phần còn lại có thể là nghĩa/ví dụ
        // Đây là một logic rất đơn giản, cần cải tiến bằng AI hoặc regex phức tạp hơn
        addWordInputField({
          word: lineWords[0],
          ipa: "", // Tesseract không cung cấp IPA
          meaning: lineWords.slice(1, 3).join(" ") || "", // Lấy 2-3 từ tiếp theo làm nghĩa tạm thời
          example: { en: line.substring(lineWords[0].length).trim(), vi: "" }, // Phần còn lại làm ví dụ tiếng Anh
        });
        wordsAddedCount++;
      }
      if (wordsAddedCount >= 50) break; // Giới hạn số lượng từ để tránh quá tải
    }

    if (wordsAddedCount === 0) {
      elements.ocrMessage.textContent =
        "Không tìm thấy từ nào hợp lệ trong tài liệu. Vui lòng kiểm tra định dạng.";
      // Thêm một trường rỗng để người dùng có thể nhập thủ công
      addWordInputField();
    } else {
      elements.ocrMessage.textContent = `Đã tìm thấy ${wordsAddedCount} từ. Đang thêm vào.`;
      addWordInputField(); // Thêm một trường trống sau cùng
    }
  } catch (error) {
    console.error("Lỗi khi xử lý OCR:", error);
    elements.ocrMessage.textContent = `Lỗi: ${error.message}. Vui lòng thử lại.`;
  } finally {
    setTimeout(() => elements.ocrStatus.classList.add("hidden"), 5000);
  }
}

async function recognizeTextFromImage(imageFile) {
  elements.ocrMessage.textContent = "Đang nhận dạng văn bản từ ảnh...";
  elements.ocrProgress.value = 0;

  if (!tesseractWorker) throw new Error("Tesseract worker chưa được khởi tạo.");
  const {
    data: { text },
  } = await tesseractWorker.recognize(imageFile);
  return text;
}

async function recognizeTextFromPdf(pdfFile) {
  elements.ocrMessage.textContent = "Đang đọc PDF và nhận dạng văn bản...";
  elements.ocrProgress.value = 0;

  const fileReader = new FileReader();
  return new Promise((resolve, reject) => {
    fileReader.onload = async () => {
      const typedarray = new Uint8Array(fileReader.result);
      try {
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        let fullText = "";
        const canvas = document.createElement("canvas");
        const canvasContext = canvas.getContext("2d");

        for (let i = 1; i <= pdf.numPages; i++) {
          elements.ocrMessage.textContent = `Đang xử lý trang ${i}/${pdf.numPages}...`;
          elements.ocrProgress.value = ((i - 1) / pdf.numPages) * 100; // Tiến độ đọc PDF

          const page = await pdf.getPage(i);
          // Scale cao hơn có thể cải thiện chất lượng OCR nhưng tốn nhiều bộ nhớ hơn
          const viewport = page.getViewport({ scale: 2 });
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({ canvasContext, viewport }).promise;

          if (!tesseractWorker)
            throw new Error("Tesseract worker chưa được khởi tạo.");
          const {
            data: { text },
          } = await tesseractWorker.recognize(canvas);
          fullText += text + "\n\n";
        }
        elements.ocrProgress.value = 100; // Đảm bảo thanh tiến độ đầy khi xong PDF
        resolve(fullText);
      } catch (error) {
        console.error("Lỗi khi đọc PDF:", error);
        reject(
          new Error(
            "Không thể đọc tệp PDF. Vui lòng kiểm tra tệp hoặc thử lại."
          )
        );
      }
    };
    fileReader.onerror = reject;
    fileReader.readAsArrayBuffer(pdfFile);
  });
}

// (Xử lý học tập)
// Hàm lật thẻ và hiển thị nút hành động
function flipCard() {
  isFlipped = !isFlipped;
  elements.flashcard.classList.toggle("flipped", isFlipped);
  // Hiển thị nút hành động khi thẻ lật mặt sau
  elements.actionButtons.classList.toggle("show", isFlipped);
  elements.flipBackBtn.classList.toggle("show", isFlipped);
}

// Hàm phát âm từ
function handlePronunciation() {
  const activeDeck = decks.find((d) => d.id === activeDeckId);
  if (!activeDeck || activeDeck.words.length === 0) return;

  const word = activeDeck.words[currentIndex];
  if (word.word && "speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(word.word);
    utterance.lang = "en-US"; // Đặt ngôn ngữ là tiếng Anh
    window.speechSynthesis.speak(utterance);
  }
}

// Hàm đánh dấu từ đã học hoặc cần xem lại (kết hợp handleMarkLearned và handleMarkReview)
async function handleMarkWord(status) {
  if (!activeDeckId) return;

  const activeDeck = decks.find((d) => d.id === activeDeckId);
  if (!activeDeck || !activeDeck.words || activeDeck.words.length === 0) return;

  const currentWord = activeDeck.words[currentIndex];
  if (!currentWord) return;

  // Khởi tạo progress cho deck nếu chưa có
  if (!progress[activeDeckId]) {
    progress[activeDeckId] = { learnedWords: new Set() };
  }

  if (status === "learned") {
    progress[activeDeckId].learnedWords.add(currentWord.id);
  } else if (status === "review") {
    progress[activeDeckId].learnedWords.delete(currentWord.id); // 'review' implies not learned
  }

  if (currentUser) {
    // Gửi cập nhật tiến độ lên backend
    try {
      const response = await fetch(
        `${BACKEND_API_URL}/progress/${activeDeckId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${currentUser.token}`,
          },
          body: JSON.stringify({ word_id: currentWord.id, status: status }),
        }
      );
      if (!response.ok) {
        console.error(
          "Failed to update progress on backend:",
          response.status,
          await response.text()
        );
        // Có thể rollback trạng thái cục bộ nếu cần
      }
    } catch (error) {
      console.error("Error updating progress with backend:", error);
    }
  }

  saveDataToStorage(); // Lưu vào localStorage (cho người dùng không đăng nhập hoặc làm fallback)
  updateDisplay(); // Cập nhật trạng thái nút và hiển thị
  handleNext(); // Tự động chuyển sang từ tiếp theo
}

// Hàm chuyển đến từ tiếp theo
function handleNext() {
  const activeDeck = decks.find((d) => d.id === activeDeckId);
  if (!activeDeck || activeDeck.words.length === 0) return;

  if (currentIndex < activeDeck.words.length - 1) {
    currentIndex++;
  } else {
    // Đã hết từ trong bộ từ, bạn có thể thông báo hoàn thành hoặc lặp lại
    console.log("Bạn đã hoàn thành bộ từ này!");
  }
  if (isFlipped) flipCard(); // Lật lại mặt trước trước khi chuyển
  updateDisplay();
}

// Hàm chuyển đến từ trước đó
function handlePrevious() {
  const activeDeck = decks.find((d) => d.id === activeDeckId);
  if (!activeDeck || activeDeck.words.length === 0) return;

  if (currentIndex > 0) {
    currentIndex--;
  }
  if (isFlipped) flipCard(); // Lật lại mặt trước trước khi chuyển
  updateDisplay();
}

// Hàm xáo trộn thứ tự các từ
function handleShuffle() {
  const activeDeck = decks.find((d) => d.id === activeDeckId);
  if (!activeDeck || activeDeck.words.length === 0) return;

  // Thuật toán Fisher-Yates shuffle
  for (let i = activeDeck.words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [activeDeck.words[i], activeDeck.words[j]] = [
      activeDeck.words[j],
      activeDeck.words[i],
    ];
  }
  currentIndex = 0; // Bắt đầu lại từ đầu sau khi xáo trộn
  isFlipped = false;
  elements.flashcard.classList.remove("flipped");
  elements.actionButtons.classList.remove("show");
  saveDataToStorage();
  updateDisplay();
}

// Hàm đặt lại tiến độ học tập của bộ từ hiện tại
function handleReset() {
  if (
    !confirm("Bạn có muốn đặt lại toàn bộ tiến độ học tập cho bộ từ này không?")
  ) {
    return;
  }
  if (activeDeckId && progress[activeDeckId]) {
    progress[activeDeckId].learnedWords.clear(); // Xóa tất cả từ đã học
  }
  currentIndex = 0;
  isFlipped = false;
  elements.flashcard.classList.remove("flipped");
  elements.actionButtons.classList.remove("show");
  saveDataToStorage();
  updateDisplay();
}

function handleKeyPress(e) {
  if (
    elements.deckModal.classList.contains("hidden") &&
    elements.loginModal.classList.contains("hidden") &&
    elements.registerModal.classList.contains("hidden") &&
    elements.chatModal.classList.contains("hidden") // Bổ sung kiểm tra modal chat
  ) {
    if (e.key === " ") {
      // Spacebar để lật thẻ
      e.preventDefault(); // Ngăn cuộn trang
      flipCard();
    } else if (e.key === "ArrowLeft") {
      // Mũi tên trái để đi từ trước
      handlePrevious();
    } else if (e.key === "ArrowRight") {
      // Mũi tên phải để đi từ tiếp theo
      handleNext();
    } else if (e.key === "Enter" && isFlipped) {
      // Enter để đánh dấu đã học (khi thẻ đã lật)
      handleMarkWord("learned");
    } else if (e.key === "Escape") {
      // Esc để đóng modal
      handleCloseDeckModal();
      closeLoginModal();
      closeRegisterModal();
      closeChatModal(); // Đóng modal chat
    }
  }
}

// --- AUTH MODAL HANDLERS ---
function openRegisterModal() {
  elements.registerModal.classList.remove("hidden");
  elements.registerEmailInput.value = "";
  elements.registerPasswordInput.value = "";
  elements.registerMessage.textContent = ""; // Clear previous messages
  elements.registerMessage.classList.add("hidden");
}

function closeRegisterModal() {
  elements.registerModal.classList.add("hidden");
}

function openLoginModal() {
  elements.loginModal.classList.remove("hidden");
  elements.loginEmailInput.value = "";
  elements.loginPasswordInput.value = "";
  elements.loginMessage.textContent = ""; // Clear previous messages
  elements.loginMessage.classList.add("hidden");
}

function closeLoginModal() {
  elements.loginModal.classList.add("hidden");
}

// --- CHAT MODAL HANDLERS ---
function openChatModal() {
  if (!currentUser) {
    alert("Vui lòng đăng nhập để sử dụng tính năng AI Coach.");
    openLoginModal();
    return;
  }
  if (elements.chatModal) elements.chatModal.classList.remove("hidden");
  if (elements.chatInput) elements.chatInput.focus();
  scrollToBottomOfChat();
}

function closeChatModal() {
  if (elements.chatModal) elements.chatModal.classList.add("hidden");
}

function appendMessage(sender, text) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `chat-message ${sender}`;
  // Sử dụng innerHTML để hỗ trợ Markdown/HTML đơn giản nếu có
  messageDiv.innerHTML = `<p>${text}</p>`;
  if (elements.chatMessagesContainer)
    elements.chatMessagesContainer.appendChild(messageDiv);

  // Lưu tin nhắn vào lịch sử (chỉ lưu vai trò và nội dung)
  const role = sender === "user" ? "user" : "assistant"; // Gửi role theo format của API
  chatHistory.push({ role: role, content: text });

  scrollToBottomOfChat();
}

function scrollToBottomOfChat() {
  if (elements.chatMessagesContainer)
    elements.chatMessagesContainer.scrollTop =
      elements.chatMessagesContainer.scrollHeight;
}

function appendTypingIndicator() {
  const indicatorDiv = document.createElement("div");
  indicatorDiv.className = "chat-message bot typing-indicator";
  // Placeholder cho hiệu ứng typing
  indicatorDiv.innerHTML = `<p>...</p>`;
  if (elements.chatMessagesContainer)
    elements.chatMessagesContainer.appendChild(indicatorDiv);
  scrollToBottomOfChat();
  return indicatorDiv;
}

async function handleSendMessage() {
  const message = elements.chatInput.value.trim();
  if (!message) return;

  // 1. Hiển thị tin nhắn người dùng
  appendMessage("user", message);
  elements.chatInput.value = "";
  elements.chatInput.style.height = "auto"; // Reset chiều cao

  // Tắt nút gửi để tránh spam
  elements.sendChatBtn.disabled = true;
  elements.chatInput.disabled = true;

  // Thêm một tin nhắn chờ (typing indicator)
  const typingIndicator = appendTypingIndicator();

  try {
    // 2. Gửi lịch sử chat lên Backend
    const response = await fetch(`${BACKEND_API_URL}/ai/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentUser.token}`,
      },
      body: JSON.stringify({
        user_message: message,
        // Gửi toàn bộ lịch sử
        history: chatHistory,
      }),
    });

    // Loại bỏ tin nhắn chờ
    typingIndicator.remove();

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        errorData.msg || "Lỗi không xác định khi giao tiếp với AI."
      );
    }

    const data = await response.json();

    // 3. Hiển thị phản hồi từ Bot
    appendMessage("bot", data.response);
  } catch (error) {
    // Nếu có lỗi, loại bỏ tin nhắn chờ (nếu vẫn còn) và thông báo lỗi
    if (typingIndicator && typingIndicator.parentElement) {
      typingIndicator.remove();
    }

    console.error("Lỗi Chatbot:", error);

    // Xóa tin nhắn người dùng khỏi lịch sử (vì bot không phản hồi đúng)
    // và thêm tin nhắn lỗi (bot) vào lịch sử
    const errorMessage = `Lỗi: ${error.message}. Xin lỗi, tôi không thể trả lời lúc này.`;
    chatHistory.pop(); // Xóa tin nhắn user vừa gửi
    appendMessage("bot", errorMessage);
  } finally {
    elements.sendChatBtn.disabled = false;
    elements.chatInput.disabled = false;
    elements.chatInput.focus();
  }
}

// --- AUTHENTICATION API INTEGRATION ---
const BACKEND_API_URL = "https://vocabflow-fullstack.onrender.com/api"; // Thay thế bằng URL backend thực tế

// Helper function to display messages in auth modals
function displayAuthMessage(element, message, type = "info") {
  element.textContent = message;
  element.classList.remove("success", "error", "hidden");
  if (type === "success") {
    element.classList.add("success");
  } else if (type === "error") {
    element.classList.add("error");
  }
  setTimeout(() => {
    element.classList.add("hidden");
    element.textContent = "";
  }, 5000);
}

// Cập nhật hàm registerUser để chấp nhận loginType
async function registerUser(username, password, loginType) {
  console.log("Đang đăng ký người dùng...", { username, password, loginType });
  try {
    const response = await fetch(`${BACKEND_API_URL}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password, login_type: loginType }),
    });
    const data = await response.json();
    if (response.ok) {
      displayAuthMessage(
        elements.registerMessage,
        data.msg || "Đăng ký thành công! Vui lòng đăng nhập.",
        "success"
      );
      setTimeout(() => {
        closeRegisterModal();
        openLoginModal();
        elements.loginEmailInput.value = username; // Pre-fill login email
      }, 1500);
    } else {
      displayAuthMessage(
        elements.registerMessage,
        `Đăng ký thất bại: ${data.msg || "Lỗi không xác định"}`,
        "error"
      );
    }
  } catch (error) {
    console.error("Lỗi mạng hoặc server khi đăng ký:", error);
    displayAuthMessage(
      elements.registerMessage,
      "Không thể kết nối đến server. Vui lòng thử lại sau.",
      "error"
    );
  }
}

// Cập nhật hàm loginUser để chấp nhận loginType
async function loginUser(username, password, loginType) {
  console.log("Đang đăng nhập người dùng...", {
    username,
    password,
    loginType,
  });
  try {
    const response = await fetch(`${BACKEND_API_URL}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password, login_type: loginType }),
    });
    const data = await response.json();
    if (response.ok) {
      displayAuthMessage(
        elements.loginMessage,
        data.msg || "Đăng nhập thành công!",
        "success"
      );
      // Lưu token và thông tin người dùng
      localStorage.setItem("vocabflow_authToken", data.access_token);
      localStorage.setItem(
        "vocabflow_currentUser",
        JSON.stringify({
          id: data.userId,
          username: data.username,
          role: data.role,
        }) // Lưu thêm role
      );
      currentUser = {
        id: data.userId,
        username: data.username,
        token: data.access_token,
        role: data.role, // Lưu role
      };

      // Xóa lịch sử chat cũ (người dùng mới) và thêm tin nhắn bot ban đầu
      chatHistory = [{ role: "assistant", content: INITIAL_BOT_MESSAGE }];
      if (elements.chatMessagesContainer)
        elements.chatMessagesContainer.innerHTML = `<div class="chat-message bot"><p>${INITIAL_BOT_MESSAGE}</p></div>`;

      setTimeout(async () => {
        closeLoginModal();
        updateAuthUI();

        // Kiểm tra quyền Admin và chuyển hướng
        if (currentUser.role === "admin") {
          alert(
            "Đăng nhập với vai trò Admin. Đang chuyển hướng đến Bảng Quản Trị."
          );
          window.location.href = "/admin.html";
          return;
        }

        // Tải lại dữ liệu cho người dùng mới đăng nhập
        await loadDataFromStorage();
        renderDeckList(); // Render lại danh sách bộ từ của người dùng

        // Chọn bộ từ đầu tiên nếu có, hoặc hiển thị placeholder
        if (decks.length > 0) {
          handleSelectDeck(decks[0].id);
        } else {
          showPlaceholder(false);
        }
        updateDisplay(); // Cập nhật màn hình học tập
      }, 1500);
    } else {
      displayAuthMessage(
        elements.loginMessage,
        `Đăng nhập thất bại: ${data.msg || "Sai tên người dùng hoặc mật khẩu"}`,
        "error"
      );
    }
  } catch (error) {
    console.error("Lỗi mạng hoặc server khi đăng nhập:", error);
    displayAuthMessage(
      elements.loginMessage,
      "Không thể kết nối đến server. Vui lòng thử lại sau.",
      "error"
    );
  }
}

async function handleRegisterEmail() {
  const username = elements.registerEmailInput.value.trim(); // Email dùng làm username
  const password = elements.registerPasswordInput.value.trim();
  if (!username || !password) {
    displayAuthMessage(
      elements.registerMessage,
      "Vui lòng nhập đầy đủ email và mật khẩu.",
      "error"
    );
    return;
  }
  await registerUser(username, password, "email"); // Sử dụng login_type "email"
}

async function handleLoginEmail() {
  const username = elements.loginEmailInput.value.trim(); // Email dùng làm username
  const password = elements.loginPasswordInput.value.trim();
  if (!username || !password) {
    displayAuthMessage(
      elements.loginMessage,
      "Vui lòng nhập đầy đủ email và mật khẩu.",
      "error"
    );
    return;
  }
  await loginUser(username, password, "email"); // Sử dụng login_type "email"
}

async function handleRegisterFacebook() {
  const username = elements.registerEmailInput.value.trim(); // Re-use email field for FB ID/email
  const password = elements.registerPasswordInput.value.trim();
  if (!username || !password) {
    displayAuthMessage(
      elements.registerMessage,
      "Vui lòng nhập ID/Email Facebook và mật khẩu.",
      "error"
    );
    return;
  }
  displayAuthMessage(
    elements.registerMessage,
    "Đang đăng ký bằng Facebook...",
    "info"
  );
  // Trong một ứng dụng thực, đây sẽ là nơi bạn khởi động luồng OAuth của Facebook.
  // Tuy nhiên, theo yêu cầu của bạn, chúng ta sẽ gửi thông tin như một form bình thường.
  await registerUser(username, password, "facebook"); // Sử dụng login_type "facebook"
}

async function handleLoginFacebook() {
  const username = elements.loginEmailInput.value.trim(); // Re-use email field for FB ID/email
  const password = elements.loginPasswordInput.value.trim();
  if (!username || !password) {
    displayAuthMessage(
      elements.loginMessage,
      "Vui lòng nhập ID/Email Facebook và mật khẩu.",
      "error"
    );
    return;
  }
  displayAuthMessage(
    elements.loginMessage,
    "Đang đăng nhập bằng Facebook...",
    "info"
  );
  await loginUser(username, password, "facebook"); // Sử dụng login_type "facebook"
}

async function handleLogout() {
  if (!confirm("Bạn có muốn đăng xuất không?")) {
    return;
  }
  // TODO: Gọi API backend để invalidate token nếu cần
  localStorage.removeItem("vocabflow_authToken");
  localStorage.removeItem("vocabflow_currentUser");
  currentUser = null;
  alert("Bạn đã đăng xuất.");
  updateAuthUI();
  // Đặt lại dữ liệu về bộ từ mặc định và xóa tiến độ (cho người dùng không đăng nhập)
  decks = [...defaultDecks]; // Reset to default decks
  progress = {}; // Clear all progress
  saveDataToStorage(); // Save the reset state
  renderDeckList();
  showPlaceholder(); // Hiển thị lại placeholder
  activeDeckId = null; // Đặt lại active deck
  currentIndex = 0; // Đặt lại index
  isFlipped = false; // Đặt lại trạng thái lật
  chatHistory = []; // Xóa lịch sử chat khi đăng xuất

  // Đóng modal chat nếu đang mở
  closeChatModal();
}

// --- START THE APP (Khởi chạy ứng dụng) ---
document.addEventListener("DOMContentLoaded", init);
// --- END OF FILE script.js ---
