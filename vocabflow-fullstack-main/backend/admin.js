/* --- START OF FILE admin.js (UPDATED FOR NEW UI) --- */

const BACKEND_API_URL = "http://127.0.0.1:5000/api";
let authToken = localStorage.getItem("vocabflow_authToken");
let usersCache = []; // Lưu cache danh sách user
let decksCache = []; // --- LIBRARY MANAGEMENT LOGIC ---
let voicesCache = []; // <- Thêm biến này
let currentViewingDeckId = null; 
// Quản lý các instance biểu đồ để tránh lỗi vẽ đè
let charts = {
  dashboard: null,
  userGrowth: null,
  systemActivity: null,
};

// --- 1. AUTHENTICATION & INIT ---
function checkAuth() {
  const userStr = localStorage.getItem("vocabflow_currentUser");
  const overlay = document.getElementById("admin-login-overlay");

  if (authToken && userStr) {
    try {
      const user = JSON.parse(userStr);
      if (user.role === "admin") {
        overlay.classList.add("hidden");
        // Xóa hiệu ứng mờ của body (nếu có trong CSS)
        document.body.style.overflow = "auto";
        initDashboard();
        return;
      }
    } catch (e) {
      console.error("Lỗi parse user", e);
    }
  }
  // Nếu chưa đăng nhập
  overlay.classList.remove("hidden");
}

// Xử lý Đăng nhập
document
  .getElementById("admin-login-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    const btn = e.target.querySelector("button");

    btn.disabled = true;
    btn.textContent = "Đang kiểm tra...";

    try {
      const res = await fetch(`${BACKEND_API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email, password: password }),
      });
      const data = await res.json();

      if (res.ok) {
        if (data.role === "admin") {
          localStorage.setItem("vocabflow_authToken", data.access_token);
          localStorage.setItem(
            "vocabflow_currentUser",
            JSON.stringify({ id: data.userId, role: data.role }),
          );
          authToken = data.access_token;
          location.reload(); // Tải lại để vào trang chính
        } else {
          alert("Tài khoản này không có quyền Quản Trị!");
        }
      } else {
        alert(data.msg || "Đăng nhập thất bại");
      }
    } catch {
      alert("Lỗi kết nối Server");
    } finally {
      btn.disabled = false;
      btn.textContent = "Truy Cập";
    }
  });

// Xử lý Đăng xuất
document.getElementById("admin-logout-btn").addEventListener("click", () => {
  if (confirm("Bạn muốn đăng xuất?")) {
    localStorage.clear();
    location.reload();
  }
});

// --- 2. NAVIGATION (CHUYỂN TAB) ---
// Logic: Tìm tất cả .nav-item, bắt sự kiện click
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();

    // 1. Xử lý UI Sidebar
    document
      .querySelectorAll(".nav-item")
      .forEach((i) => i.classList.remove("active"));
    item.classList.add("active");

    // 2. Hiển thị Tab nội dung tương ứng
    const tabName = item.getAttribute("data-tab"); // dashboard, users, stats, config, library

    document.querySelectorAll(".tab-content").forEach((tab) => {
      tab.classList.remove("active");
      // Ẩn hẳn để tránh xung đột layout
      tab.style.display = "none";
    });

    const activeTab = document.getElementById(`tab-${tabName}`);
    if (activeTab) {
      activeTab.style.display = "block";
      // Timeout nhỏ để animation CSS hoạt động (nếu có)
      setTimeout(() => activeTab.classList.add("active"), 10);
    }

    // 3. Load dữ liệu khi chuyển tab
    if (tabName === "users") loadUsers();
    if (tabName === "dashboard") loadStats();
    if (tabName === "stats") loadStats(); // Vẽ biểu đồ chi tiết qua loadStats
    if (tabName === "library") loadAdminDecks(); // <--- THÊM DÒNG NÀY
    if (tabName === "config") loadConfigs();
    if (tabName === "moderation") loadPendingDecks();
    if (tabName === "voices") loadAdminVoices(); // <- THÊM DÒNG NÀY
  });
});

// --- 3. DASHBOARD & STATS LOGIC ---
async function initDashboard() {
  // Hiển thị ngày tháng
  const dateEl = document.getElementById("current-date");
  if (dateEl)
    dateEl.textContent = "Hôm nay: " + new Date().toLocaleDateString("vi-VN");

  loadStats();
}

async function loadStats() {
  try {
    const res = await fetch(`${BACKEND_API_URL}/admin/stats`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok) {
      const stats = await res.json();

      // Cập nhật số liệu Tổng quan (Dashboard)
      updateText("stat-total-users", stats.total_users);
      updateText("stat-total-decks", stats.total_decks);
      updateText("stat-total-learned", stats.total_learned);

      // Cập nhật số liệu Chi tiết (Tab Stats)
      updateText("stat-public-decks", stats.deck_breakdown.public);
      updateText("stat-private-decks", stats.deck_breakdown.private);

      // Vẽ lại các biểu đồ với dữ liệu mới
      renderDetailedCharts(stats);
    }
  } catch (e) {
    console.error("Lỗi load stats", e);
  }
}

function renderDetailedCharts(stats) {
  // 1. Biểu đồ Dashboard Overview (Bar) - Cập nhật dữ liệu thật
  const ctxDash = document.getElementById("dashboardChart");
  if (ctxDash) {
    if (charts.dashboard) charts.dashboard.destroy();
    charts.dashboard = new Chart(ctxDash, {
      type: "bar",
      data: {
        labels: ["Người dùng", "Bộ từ", "Từ đã học"],
        datasets: [
          {
            label: "Số lượng hệ thống",
            data: [stats.total_users, stats.total_decks, stats.total_learned],
            backgroundColor: ["#3b82f6", "#10b981", "#8b5cf6"],
            borderRadius: 8,
          },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
  }

  // 2. Biểu đồ Tăng trưởng Người dùng (Tab Stats)
  const ctxGrowth = document.getElementById("userGrowthChart");
  if (ctxGrowth) {
    if (charts.userGrowth) charts.userGrowth.destroy();
    const labels = stats.user_growth.map((d) =>
      d.date.split("-").slice(1).join("/"),
    ); // Lấy dạng MM/DD
    const data = stats.user_growth.map((d) => d.count);

    charts.userGrowth = new Chart(ctxGrowth, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "User mới",
            data: data,
            borderColor: "#6366f1",
            backgroundColor: "rgba(99, 102, 241, 0.1)",
            fill: true,
            tension: 0.4,
          },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
  }

  // 3. Biểu đồ Hoạt động hệ thống (Tab Stats)
  const ctxActivity = document.getElementById("systemActivityChart");
  if (ctxActivity) {
    if (charts.systemActivity) charts.systemActivity.destroy();
    const labels = stats.system_activity.map((d) =>
      d.date.split("-").slice(1).join("/"),
    );
    const data = stats.system_activity.map((d) => d.count);

    charts.systemActivity = new Chart(ctxActivity, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Từ vựng được thuộc",
            data: data,
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.1)",
            fill: true,
            tension: 0.4,
          },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
  }
}

function updateText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// --- 4. USER MANAGEMENT LOGIC ---
async function loadUsers() {
  const tbody = document.getElementById("user-table-body");
  if (!tbody) return;

  tbody.innerHTML =
    "<tr><td colspan='5' style='text-align:center; padding: 20px;'>Đang tải dữ liệu...</td></tr>";

  try {
    const res = await fetch(`${BACKEND_API_URL}/admin/users`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      usersCache = data.users; // Lưu cache để search
      renderUsers(usersCache);
    } else {
      throw new Error("API Error");
    }
  } catch {
    tbody.innerHTML =
      "<tr><td colspan='5' style='text-align:center; color:red;'>Không thể tải dữ liệu</td></tr>";
  }
}

function renderUsers(users) {
  const tbody = document.getElementById("user-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (users.length === 0) {
    tbody.innerHTML =
      "<tr><td colspan='5' style='text-align:center;'>Không tìm thấy kết quả</td></tr>";
    return;
  }

  users.forEach((user) => {
    // Tạo Badge màu sắc
    const roleClass = user.role === "admin" ? "badge admin" : "badge student";
    const statusClass =
      user.status === "banned" ? "badge banned" : "badge active";

    const tr = document.createElement("tr");
    tr.innerHTML = `
            <td>
                <div style="font-weight:600; color: #1e293b;">${user.username}</div>
                <div style="font-size: 0.75rem; color: #94a3b8;">ID: ${user._id.slice(-6)}</div>
            </td>
            <td><span class="${roleClass}">${user.role === "admin" ? "Quản trị" : "Học viên"}</span></td>
            <td><span class="${statusClass}">${user.status === "active" ? "Hoạt động" : "Đã khóa"}</span></td>
            <td style="font-size: 0.9rem; color: #64748b;">${user.created_at || "N/A"}</td>
            <td style="text-align: right;">
                <button class="btn btn-outline" style="padding: 6px 12px; font-size: 0.8rem;" onclick="editUser('${user._id}')">
                    <i class="fa-solid fa-pen"></i> Sửa
                </button>
                <button class="btn btn-danger" style="padding: 6px 12px; font-size: 0.8rem; margin-left: 5px;" onclick="deleteUser('${user._id}')">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
    tbody.appendChild(tr);
  });
}

// Search & Filter (Users)
const searchInput = document.getElementById("search-user");
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = usersCache.filter((u) =>
      u.username.toLowerCase().includes(term),
    );
    renderUsers(filtered);
  });
}

const roleFilter = document.getElementById("filter-role");
if (roleFilter) {
  roleFilter.addEventListener("change", (e) => {
    const role = e.target.value;
    if (role === "all") renderUsers(usersCache);
    else {
      const filtered = usersCache.filter((u) => u.role === role);
      renderUsers(filtered);
    }
  });
}

// --- LIBRARY MANAGEMENT LOGIC ---

async function loadAdminDecks() {
  const tbody = document.getElementById("deck-table-body");
  if (!tbody) return;

  tbody.innerHTML =
    "<tr><td colspan='6' style='text-align:center; padding:20px;'>Đang tải dữ liệu...</td></tr>";

  try {
    const res = await fetch(`${BACKEND_API_URL}/admin/decks`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      decksCache = data.decks;
      renderDecks(decksCache);
    }
  } catch {
    tbody.innerHTML =
      "<tr><td colspan='6' style='text-align:center; color:red;'>Lỗi tải dữ liệu</td></tr>";
  }
}

function renderDecks(decks) {
  const tbody = document.getElementById("deck-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (decks.length === 0) {
    tbody.innerHTML =
      "<tr><td colspan='6' style='text-align:center;'>Chưa có bộ từ nào</td></tr>";
    return;
  }

  decks.forEach((deck) => {
    const statusBadge = deck.is_public
      ? `<span class="badge active" style="background:#dbeafe; color:#1e40af;">Public</span>`
      : `<span class="badge student">Private</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
            <td><strong>${deck.name}</strong></td>
            <td>${deck.author}</td>
            <td>${deck.word_count}</td>
            <td>${statusBadge}</td>
            <td>${deck.downloads}</td>
            <td style="text-align: right;">
                <button class="btn btn-danger" style="padding: 5px 10px; font-size: 0.8rem;" onclick="deleteDeck('${deck.id}')">
                    <i class="fa-solid fa-trash"></i> Xóa
                </button>
            </td>
        `;
    tbody.appendChild(tr);
  });
}

// Filter Decks
const filterDeckType = document.getElementById("filter-deck-type");
if (filterDeckType) {
  filterDeckType.addEventListener("change", (e) => {
    const type = e.target.value;
    if (type === "all") renderDecks(decksCache);
    else {
      const isPublic = type === "public";
      const filtered = decksCache.filter((d) => d.is_public === isPublic);
      renderDecks(filtered);
    }
  });
}

// Search Decks
const searchDeckInput = document.getElementById("search-deck");
if (searchDeckInput) {
  searchDeckInput.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = decksCache.filter((d) =>
      d.name.toLowerCase().includes(term),
    );
    renderDecks(filtered);
  });
}

// --- 5. MODAL & CRUD ---
const userModal = document.getElementById("user-modal");
const deckModal = document.getElementById("deck-modal");

// Hàm global để nút HTML gọi được
window.openUserModal = () => {
  document.getElementById("user-form").reset();
  document.getElementById("form-user-id").value = "";
  document.getElementById("modal-title").textContent = "Thêm Người Dùng Mới";
  userModal.classList.remove("hidden");
};

window.closeUserModal = () => userModal.classList.add("hidden");

window.editUser = (id) => {
  const user = usersCache.find((u) => u._id === id);
  if (!user) return;

  document.getElementById("form-user-id").value = user._id;
  document.getElementById("form-email").value = user.username;
  document.getElementById("form-role").value = user.role;
  document.getElementById("form-status").value = user.status || "active";
  document.getElementById("form-password").placeholder =
    "Nhập nếu muốn đổi mật khẩu mới";

  document.getElementById("modal-title").textContent = "Chỉnh Sửa Tài Khoản";
  userModal.classList.remove("hidden");
};

// --- DECK MODAL LOGIC ---

window.openDeckModal = () => {
  const deckForm = document.getElementById("deck-form");
  if (deckForm) deckForm.reset();
  if (deckModal) deckModal.classList.remove("hidden");
};

window.closeDeckModal = () => {
  if (deckModal) deckModal.classList.add("hidden");
};

// Handle Create Deck
const deckForm = document.getElementById("deck-form");
if (deckForm) {
  deckForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("deck-name").value;
    const isPublic = document.getElementById("deck-public").value === "true";
    const rawWords = document.getElementById("deck-words-raw").value;

    // Parse Textarea (Word - Meaning)
    const words = rawWords
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const parts = line.split("-");
        // Nếu người dùng nhập "Word - Nghĩa", tách ra. Nếu không có dấu -, lấy cả dòng làm word.
        if (parts.length >= 2) {
          return {
            word: parts[0].trim(),
            meaning: parts.slice(1).join("-").trim(),
            example: { en: "", vi: "" }, // Tạo trống
          };
        } else {
          return {
            word: line.trim(),
            meaning: "Chưa cập nhật",
            example: { en: "", vi: "" },
          };
        }
      });

    if (words.length === 0) {
      alert("Vui lòng nhập ít nhất một từ vựng.");
      return;
    }

    const btn = e.target.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Đang lưu...";

    try {
      const res = await fetch(`${BACKEND_API_URL}/decks`, {
        // Sử dụng lại API tạo deck
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          name: name,
          words: words,
          is_public: isPublic,
        }),
      });

      if (res.ok) {
        alert("Tạo bộ từ thành công!");
        closeDeckModal();
        loadAdminDecks();
      } else {
        const err = await res.json();
        alert("Lỗi: " + err.msg);
      }
    } catch {
      alert("Lỗi kết nối server");
    } finally {
      btn.disabled = false;
      btn.textContent = "Lưu Bộ Từ";
    }
  });
}

// Lưu User
document.getElementById("user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("form-user-id").value;
  const email = document.getElementById("form-email").value;
  const password = document.getElementById("form-password").value;
  const role = document.getElementById("form-role").value;
  const status = document.getElementById("form-status").value;

  if (!id && !password) {
    alert("Vui lòng nhập mật khẩu cho tài khoản mới");
    return;
  }

  const url = id
    ? `${BACKEND_API_URL}/admin/users/${id}`
    : `${BACKEND_API_URL}/admin/users`;
  const method = id ? "PUT" : "POST";

  const body = { email, role, status };
  if (password) body.password = password;

  try {
    const res = await fetch(url, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      alert("Thao tác thành công!");
      closeUserModal();
      loadUsers(); // Tải lại bảng
      loadStats(); // Cập nhật thống kê
    } else {
      const err = await res.json();
      alert("Lỗi: " + err.msg);
    }
  } catch {
    alert("Lỗi kết nối server");
  }
});

// Xóa User
window.deleteUser = async (id) => {
  if (
    !confirm(
      "CẢNH BÁO: Hành động này sẽ xóa vĩnh viễn tài khoản và dữ liệu học tập. Bạn chắc chứ?",
    )
  )
    return;

  try {
    const res = await fetch(`${BACKEND_API_URL}/admin/users/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok) {
      alert("Đã xóa thành công.");
      loadUsers();
      loadStats();
    } else {
      alert("Lỗi khi xóa.");
    }
  } catch {
    alert("Lỗi kết nối.");
  }
};

// Delete Deck
window.deleteDeck = async (id) => {
  if (
    !confirm(
      "Xóa bộ từ này sẽ xóa luôn dữ liệu học của người dùng liên quan. Tiếp tục?",
    )
  )
    return;
  try {
    const res = await fetch(`${BACKEND_API_URL}/admin/decks/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok) {
      alert("Đã xóa.");
      loadAdminDecks();
    } else {
      alert("Lỗi khi xóa.");
    }
  } catch {
    alert("Lỗi kết nối.");
  }
};

// --- 6. SYSTEM CONFIGURATION LOGIC ---

async function loadConfigs() {
  const container = document.getElementById("config-list-container");
  if (!container) return;

  container.innerHTML =
    '<p style="text-align: center; color: var(--text-muted);">Đang tải cấu hình...</p>';

  try {
    const res = await fetch(`${BACKEND_API_URL}/admin/config`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      renderConfigs(data.configs);
    } else {
      throw new Error("Không thể tải cấu hình");
    }
  } catch (e) {
    container.innerHTML = `<p style="text-align: center; color: red;">Lỗi: ${e.message}</p>`;
  }
}

function renderConfigs(configs) {
  const container = document.getElementById("config-list-container");
  container.innerHTML = "";

  configs.forEach((cfg) => {
    const configItem = document.createElement("div");
    configItem.style.display = "flex";
    configItem.style.alignItems = "flex-end";
    configItem.style.gap = "1rem";
    configItem.style.padding = "1rem";
    configItem.style.background = "#f8fafc";
    configItem.style.borderRadius = "8px";
    configItem.style.border = "1px solid var(--border-color)";

    configItem.innerHTML = `
            <div style="flex: 1;">
                <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-main);">${cfg.label}</label>
                <input type="text" id="input-config-${cfg.key}" class="form-input" value="${cfg.value}" style="background: white;">
            </div>
            <button class="btn btn-primary" onclick="handleUpdateConfig('${cfg.key}', this)">
                <i class="fa-solid fa-floppy-disk"></i> Lưu
            </button>
        `;
    container.appendChild(configItem);
  });
}

window.handleUpdateConfig = async (key, btn) => {
  const input = document.getElementById(`input-config-${key}`);
  const newValue = input.value.trim();

  if (!newValue) {
    alert("Giá trị không được để trống");
    return;
  }

  const oldText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    const res = await fetch(`${BACKEND_API_URL}/admin/config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ key: key, value: newValue }),
    });

    if (res.ok) {
      alert(`Cập nhật "${key}" thành công!`);
    } else {
      const data = await res.json();
      alert(data.msg || "Lỗi cập nhật");
    }
  } catch (e) {
    alert("Lỗi kết nối server");
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldText;
  }
};
// --- 7. MODERATION LOGIC (Kiểm duyệt bộ từ) ---

async function loadPendingDecks() {
    const tbody = document.getElementById("moderation-table-body");
    if (!tbody) return;

    tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding:20px;'>Đang tải dữ liệu...</td></tr>";

    try {
        const res = await fetch(`${BACKEND_API_URL}/admin/pending_decks`, {
            headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
            const data = await res.json();
            renderModerationTable(data.pending_decks);
        }
    } catch {
        tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; color:red;'>Lỗi tải dữ liệu kiểm duyệt</td></tr>";
    }
}

function renderModerationTable(decks) {
    const tbody = document.getElementById("moderation-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (decks.length === 0) {
        tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding: 2rem;'>Hiện tại không có bộ từ nào chờ duyệt.</td></tr>";
        return;
    }

    decks.forEach((deck) => {
        const tr = document.createElement("tr");
        let requestTypeBadge = '';
        if (deck.request_type === 'publish') requestTypeBadge = '<span class="badge active" style="background:#dbeafe; color:#1e40af;">Chia sẻ/Cập nhật</span>';
        else if (deck.request_type === 'delete') requestTypeBadge = '<span class="badge banned">Yêu cầu gỡ bỏ</span>';

        tr.innerHTML = `
            <td><strong>${deck.name}</strong></td>
            <td>${deck.author}</td>
            <td><span class="badge student">${deck.word_count} từ</span></td>
            <td>${deck.submitted_at}</td>
            <td>${requestTypeBadge}</td>
            <td style="text-align: right;">
                <button class="btn btn-outline btn-sm" onclick="openPreviewDeckModal('${deck.id}')" style="margin-right: 5px;">
                    <i class="fa-solid fa-eye"></i> Xem
                </button>
                <button class="btn btn-primary btn-sm" onclick="processModeration('${deck.id}', 'approve')" title="Duyệt yêu cầu">
                    <i class="fa-solid fa-check"></i>
                </button>
                <button class="btn btn-danger btn-sm" style="margin-left: 5px;" onclick="processModeration('${deck.id}', 'reject')" title="Từ chối yêu cầu">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.processModeration = async (deckId, action) => {
    const confirmMsg = action === 'approve' ? "Phê duyệt bộ từ này lên Thư viện?" : "Từ chối bộ từ này?";
    if (!confirm(confirmMsg)) return;

    try {
        const res = await fetch(`${BACKEND_API_URL}/admin/approve_deck/${deckId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify({ action: action })
        });

        if (res.ok) {
            alert(action === 'approve' ? "Đã phê duyệt thành công!" : "Đã từ chối.");
            loadPendingDecks(); // Tải lại bảng sau khi xử lý
        } else {
            const err = await res.json();
            alert("Lỗi: " + err.msg);
        }
    } catch {
        alert("Lỗi kết nối server");
    }
};
const previewDeckModal = document.getElementById("preview-deck-modal");
const previewWordsTableBody = document.getElementById("preview-words-table-body");
const deckHistoryList = document.getElementById("deck-history-list");

window.openPreviewDeckModal = async (deckId) => {
    if (!previewDeckModal) return;
    currentViewingDeckId = deckId; // Lưu lại ID bộ từ đang xem

    // Clear nội dung cũ
    document.getElementById("preview-deck-name").textContent = "Đang tải...";
    document.getElementById("preview-deck-author").textContent = "...";
    document.getElementById("preview-word-count").textContent = "...";
    document.getElementById("preview-request-type").textContent = "...";
    previewWordsTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 1rem;">Đang tải từ vựng...</td></tr>';
    deckHistoryList.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Nhấn "Xem lịch sử" để tải.</p>';


    try {
        const res = await fetch(`${BACKEND_API_URL}/admin/pending_decks`, {
            headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
            const data = await res.json();
            const deck = data.pending_decks.find(d => d.id === deckId);
            if (!deck) {
                alert("Không tìm thấy bộ từ này trong danh sách chờ duyệt.");
                return;
            }

            document.getElementById("preview-deck-name").textContent = deck.name;
            document.getElementById("preview-deck-author").textContent = deck.author;
            document.getElementById("preview-word-count").textContent = deck.word_count;
            
            let requestTypeText = '';
            if (deck.request_type === 'publish') requestTypeText = 'Chia sẻ/Cập nhật';
            else if (deck.request_type === 'delete') requestTypeText = 'Gỡ bỏ';
            document.getElementById("preview-request-type").textContent = requestTypeText;

            // Render danh sách từ vựng
            previewWordsTableBody.innerHTML = "";
            if (deck.words && deck.words.length > 0) {
                deck.words.forEach(word => {
                    const tr = document.createElement("tr");
                    tr.innerHTML = `
                        <td><strong>${word.word || ''}</strong></td>
                        <td><small>${word.ipa || ''}</small></td>
                        <td>${word.meaning || ''}</td>
                        <td><em class="text-muted">${word.example_en || ''}</em></td>
                    `;
                    previewWordsTableBody.appendChild(tr);
                });
            } else {
                previewWordsTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 1rem;">Bộ từ này không có từ vựng.</td></tr>';
            }
            
            previewDeckModal.classList.remove("hidden"); // Mở modal sau khi tải xong data

        } else {
            alert("Lỗi khi tải thông tin bộ từ.");
        }
    } catch (e) {
        console.error("Lỗi mở preview modal:", e);
        alert("Không thể tải thông tin bộ từ.");
    }
};

window.closePreviewDeckModal = () => {
    if (previewDeckModal) previewDeckModal.classList.add("hidden");
    currentViewingDeckId = null; // Reset ID
};

// 4. Thêm hàm loadDeckHistory (Sửa trong admin.js)
// --- TRONG HÀM loadDeckHistory (SỬA LỖI TẢI LỊCH SỬ) ---
// --- TRONG HÀM loadDeckHistory (FIXED: TypeError: entry.get is not a function) ---
window.loadDeckHistory = async (deckId) => {
    const deckHistoryList = document.getElementById("deck-history-list");
    if (!deckHistoryList) return;
    
    deckHistoryList.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Đang tải lịch sử...</p>';

    try {
        const response = await fetch(`${BACKEND_API_URL}/admin/deck_history/${deckId}`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        if (response.ok) {
            const data = await response.json();
            deckHistoryList.innerHTML = "";
            if (data.history && data.history.length > 0) {
                // Sắp xếp lịch sử theo thời gian mới nhất lên đầu
                data.history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                data.history.forEach(entry => {
                    const p = document.createElement("p");
                    let actionText = '';
                    let actionClass = '';
                    // SỬA LỖI: Dùng cú pháp truy cập object.property hoặc object['property']
                    const versionTag = entry.version_tag || ''; 
                    const action = entry.action || '';
                    const timestamp = entry.timestamp || '';

                    if (action === 'submit_update' || action === 'submit_update_public_deck') {
                        actionText = `Yêu cầu chia sẻ/cập nhật phiên bản <span class="history-version">${versionTag}</span>`;
                        actionClass = 'text-primary';
                    } else if (action === 'request_delete') {
                        actionText = `Yêu cầu gỡ bỏ bộ từ`;
                        actionClass = 'text-danger';
                    } else if (action === 'approved_publish') {
                        actionText = `Admin đã phê duyệt đăng phiên bản <span class="history-version">${versionTag}</span>`;
                        actionClass = 'text-success';
                    } else if (action === 'approved_delete') {
                        actionText = `Admin đã phê duyệt gỡ bỏ bộ từ`;
                        actionClass = 'text-danger';
                    } else if (action === 'rejected') {
                        actionText = `Admin đã từ chối yêu cầu cho phiên bản <span class="history-version">${versionTag}</span>`;
                        actionClass = 'text-warning';
                    } else {
                        actionText = `Hành động không xác định (${action})`;
                        actionClass = 'text-muted';
                    }
                    p.innerHTML = `<small class="history-timestamp">${timestamp}:</small> <span class="${actionClass}">${actionText}</span>`;
                    deckHistoryList.appendChild(p);
                });
            } else {
                deckHistoryList.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Không có lịch sử yêu cầu nào cho bộ từ này.</p>';
            }
        }
    } catch (e) {
        console.error("Lỗi tải lịch sử chi tiết:", e);
        deckHistoryList.innerHTML = '<p style="text-align: center; color: red;">Lỗi tải lịch sử.</p>';
    }
};

// --- 8. VOICES MANAGEMENT LOGIC (Quản lý giọng đọc) ---

async function loadAdminVoices() {
    const tbody = document.getElementById("voices-table-body");
    if (!tbody) return;

    tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding:20px;'>Đang tải dữ liệu...</td></tr>";

    try {
        const res = await fetch(`${BACKEND_API_URL}/admin/voices`, {
            headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
            const data = await res.json();
            voicesCache = data.voices;
            renderVoicesTable(voicesCache);
        }
    } catch {
        tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; color:red;'>Lỗi tải danh sách giọng đọc</td></tr>";
    }
}

function renderVoicesTable(voices) {
    const tbody = document.getElementById("voices-table-body");
    tbody.innerHTML = "";

    voices.forEach((voice) => {
        const tr = document.createElement("tr");
        
        // Style cho nút Bật/Tắt
        const isStatusOn = voice.status === 'on';
        const toggleBtnClass = isStatusOn ? 'btn-success' : 'btn-outline';
        const toggleIcon = isStatusOn ? 'fa-toggle-on' : 'fa-toggle-off';
        const statusBadge = isStatusOn ? '<span class="badge active">ON</span>' : '<span class="badge inactive">OFF</span>';

        // Biểu tượng khu vực
        let flag = "🌐";
        if (voice.region === 'US') flag = "🇺🇸";
        else if (voice.region === 'UK') flag = "🇬🇧";
        else if (voice.region === 'AU') flag = "🇦🇺";

        tr.innerHTML = `
            <td style="color: var(--text-muted); font-size: 0.85rem;">${voice.id}</td>
            <td>
                <input type="text" id="voice-name-${voice.id}" class="form-input" value="${voice.name}" style="padding: 0.4rem 0.8rem; width: 250px;">
            </td>
            <td>${flag} ${voice.region} - ${voice.gender}</td>
            <td style="text-align: center;">${statusBadge}</td>
            <td style="text-align: right; white-space: nowrap;">
                <button class="btn btn-primary btn-sm" onclick="testVoice('${voice.id}')" title="Nghe thử giọng này">
                    <i class="fa-solid fa-play"></i> Nghe
                </button>
                <button class="btn ${toggleBtnClass} btn-sm" style="margin-left: 5px;" onclick="toggleVoiceStatus('${voice.id}', '${isStatusOn ? 'off' : 'on'}')" title="Bật/Tắt hiển thị">
                    <i class="fa-solid ${toggleIcon}"></i> ${isStatusOn ? 'Tắt' : 'Bật'}
                </button>
                <button class="btn btn-outline btn-sm" style="margin-left: 5px; color: #6366f1;" onclick="saveVoiceName('${voice.id}')" title="Lưu Tên hiển thị">
                    <i class="fa-solid fa-floppy-disk"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Logic: Bật/Tắt giọng
window.toggleVoiceStatus = async (voiceId, newStatus) => {
    try {
        const res = await fetch(`${BACKEND_API_URL}/admin/voices/${voiceId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ status: newStatus })
        });
        if (res.ok) {
            loadAdminVoices(); // Reload lại bảng để thấy trạng thái mới
        }
    } catch (e) { alert("Lỗi khi cập nhật trạng thái"); }
};

// Logic: Lưu Tên Hiển Thị (User sẽ thấy tên này)
window.saveVoiceName = async (voiceId) => {
    const input = document.getElementById(`voice-name-${voiceId}`);
    const newName = input.value.trim();
    if (!newName) { alert("Tên không được để trống"); return; }

    try {
        const res = await fetch(`${BACKEND_API_URL}/admin/voices/${voiceId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ name: newName })
        });
        if (res.ok) alert("Đã lưu tên hiển thị mới!");
    } catch (e) { alert("Lỗi lưu tên"); }
};

// Logic: Phát âm (Nghe thử ngay trong Admin)
let currentAudio = null;
window.testVoice = (voiceId) => {
    if (currentAudio) currentAudio.pause(); // Dừng âm thanh cũ nếu đang phát
    
    // Câu nói mẫu để test
    const testText = "Hello! I am your English coach on VocabFlow.";
    
    // Gọi API Audio mà chúng ta vừa viết ở Backend
    const audioUrl = `${BACKEND_API_URL}/audio?text=${encodeURIComponent(testText)}&voice=${voiceId}`;
    
    currentAudio = new Audio(audioUrl);
    currentAudio.play().catch(e => {
        console.error("Lỗi phát âm thanh:", e);
        alert("Không thể phát âm thanh. Vui lòng kiểm tra lại Backend.");
    });
};

// Placeholder for initCharts
function initCharts() {}

// KHỞI CHẠY
document.addEventListener("DOMContentLoaded", () => {
  checkAuth();
});
/* --- END OF FILE admin.js --- */