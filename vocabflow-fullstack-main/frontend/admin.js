document.addEventListener("DOMContentLoaded", () => {
  // --- CONFIG & STATE ---
  // Cập nhật URL API backend thực tế của bạn
  const BACKEND_API_URL = "https://vocabflow-fullstack.onrender.com/api";

  // Lấy thông tin xác thực từ localStorage
  let authToken = localStorage.getItem("vocabflow_authToken");
  let currentUser = JSON.parse(
    localStorage.getItem("vocabflow_currentUser") || "{}"
  );

  let editingUserId = null;

  // --- DOM ELEMENTS ---
  const elements = {
    // === Sidebar Components ===
    menuToggleBtn: document.getElementById("menu-toggle-btn"),
    adminSidebar: document.getElementById("admin-sidebar"),
    sidebarOverlay: document.getElementById("admin-sidebar-overlay"),
    closeSidebarBtn: document.getElementById("close-sidebar-btn"),
    sidebarNav: document.querySelector(".admin-sidebar-nav"),
    // === Các elements khác ===
    navLinks: document.querySelectorAll(".admin-sidebar-nav .nav-link"),
    adminPages: document.querySelectorAll(".admin-page"),
    userTableBody: document.getElementById("user-table-body"),
    addNewUserBtn: document.getElementById("add-new-user-btn"),
    userModal: document.getElementById("user-modal"),
    closeUserModalBtn: document.getElementById("close-user-modal-btn"),
    cancelUserModalBtn: document.getElementById("cancel-user-modal-btn"),
    userModalTitle: document.getElementById("user-modal-title"),
    userForm: document.getElementById("user-form"),
    saveUserBtn: document.getElementById("save-user-btn"),
    userIdInput: document.getElementById("user-id-input"),
    userEmailInput: document.getElementById("user-email-input"),
    userPasswordInput: document.getElementById("user-password-input"),
    userStatusInput: document.getElementById("user-status-input"),
    userRoleInput: document.getElementById("user-role-input"),
    searchUserInput: document.getElementById("search-user-input"),
    searchUserBtn: document.getElementById("search-user-btn"),
    logoutBtnAdmin: document.getElementById("logout-btn-admin"),
    configGeneralForm: document.getElementById("config-general-form"),
    configNotificationForm: document.getElementById("config-notification-form"),
    backupBtn: document.getElementById("backup-btn"),
    restoreBtn: document.getElementById("restore-btn"),
  };

  // --- UTILITY FUNCTIONS ---

  function handleLogout() {
    // Xóa token và chuyển hướng về trang đăng nhập
    localStorage.removeItem("vocabflow_authToken");
    localStorage.removeItem("vocabflow_currentUser");
    window.location.href = "/index.html";
  }

  /**
   * Helper function for making authenticated API calls.
   * @param {string} url - The API endpoint URL.
   * @param {object} options - Fetch options (method, body, etc.).
   */
  async function authenticatedFetch(url, options = {}) {
    if (!authToken) {
      alert(
        "Phiên đăng nhập Admin hết hạn hoặc không tồn tại. Đang chuyển hướng."
      );
      handleLogout();
      return null;
    }

    const defaultHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    };

    const config = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      // Nếu JWT hết hạn hoặc không hợp lệ (401, 403), chuyển hướng
      if (response.status === 401 || response.status === 403) {
        alert(
          "Bạn không có quyền truy cập trang này hoặc phiên làm việc đã hết hạn."
        );
        handleLogout();
        return null;
      }
      return response;
    } catch (error) {
      console.error("Lỗi mạng:", error);
      alert("Lỗi kết nối đến Backend API. Vui lòng kiểm tra server.");
      return null;
    }
  }

  // Hàm này được sử dụng trong hàm `init` để kiểm tra quyền truy cập
  async function checkAdminAccess() {
    // Kiểm tra token và vai trò trong localStorage (kiểm tra nhanh)
    if (!authToken || currentUser.role !== "admin") {
      console.warn("Truy cập bị từ chối: Không phải Admin hoặc thiếu Token.");
      alert("Bạn không có quyền truy cập vào Bảng Quản Trị.");
      window.location.href = "/index.html"; // Chuyển hướng về trang người dùng
      return false;
    }

    // Kiểm tra với Backend (kiểm tra an toàn hơn) bằng cách gọi một endpoint bảo vệ
    // Dùng HEAD để kiểm tra quyền mà không tải hết dữ liệu.
    const response = await authenticatedFetch(
      `${BACKEND_API_URL}/admin/users`,
      { method: "HEAD" }
    );

    if (response && response.ok) {
      console.log("Admin access confirmed.");
      return true;
    } else {
      console.error("Backend từ chối truy cập Admin.");
      alert("Phiên đăng nhập Admin không hợp lệ.");
      handleLogout();
      return false;
    }
  }

  // --- USER MANAGEMENT FUNCTIONS ---

  async function loadUsers(query = "") {
    const url = `${BACKEND_API_URL}/admin/users`; // Backend chưa hỗ trợ query param search
    const response = await authenticatedFetch(url);

    if (response && response.ok) {
      const data = await response.json();

      // Xử lý tìm kiếm ở Frontend tạm thời nếu Backend chưa hỗ trợ search
      let usersToRender = data.users;
      if (query) {
        const lowerCaseQuery = query.toLowerCase();
        usersToRender = usersToRender.filter((user) =>
          user.username.toLowerCase().includes(lowerCaseQuery)
        );
      }

      renderUserTable(usersToRender);
      // Cập nhật thống kê tạm thời
      document.getElementById("stat-total-users").textContent =
        data.users.length.toLocaleString("en-US");
    } else {
      elements.userTableBody.innerHTML =
        '<tr><td colspan="6" style="text-align: center;">Không thể tải dữ liệu người dùng.</td></tr>';
    }
  }

  // --- RENDER FUNCTIONS ---
  function renderUserTable(users = []) {
    if (!elements.userTableBody) return;

    const tableRows = users
      .map(
        (user) => `
            <tr>
                <td>${user._id.substring(0, 8)}...</td>
                <td>${user.username}</td>
                <td>${user.created_at}</td>
                <td><span class="status-badge ${
                  user.status
                }">${user.status.toUpperCase()}</span></td>
                <td><span class="status-badge role-badge ${
                  user.role
                }">${user.role.toUpperCase()}</span></td>
                <td class="table-actions">
                    <button class="btn btn-outline btn-sm btn-edit" data-action="edit" data-id="${
                      user._id
                    }">Sửa</button>
                    <button class="btn btn-outline btn-sm btn-delete" data-action="delete" data-id="${
                      user._id
                    }">Xóa</button>
                </td>
            </tr>
        `
      )
      .join("");

    elements.userTableBody.innerHTML = tableRows;
  }

  // --- MODAL HANDLERS ---

  function openUserModal(user = null) {
    if (!elements.userModal) return;
    elements.userForm.reset();
    editingUserId = user ? user._id : null;
    elements.userPasswordInput.required = !user;

    elements.userModalTitle.textContent = user
      ? "Sửa Tài Khoản"
      : "Thêm Tài Khoản Mới";

    if (user) {
      elements.userIdInput.value = user._id;
      elements.userEmailInput.value = user.username;
      elements.userRoleInput.value = user.role;
      elements.userStatusInput.value = user.status;
      elements.userPasswordInput.placeholder =
        "Để trống nếu không muốn thay đổi";
    } else {
      elements.userPasswordInput.placeholder = "Tạo mật khẩu cho người dùng";
    }

    elements.userModal.classList.remove("hidden");
  }

  function closeUserModal() {
    if (!elements.userModal) return;
    elements.userModal.classList.add("hidden");
    editingUserId = null;
  }

  async function handleSaveUser(e) {
    e.preventDefault();

    // 1. Thu thập dữ liệu
    const email = elements.userEmailInput.value.trim();
    const password = elements.userPasswordInput.value.trim();
    const role = elements.userRoleInput.value;
    const status = elements.userStatusInput.value;

    if (!email || (!editingUserId && !password)) {
      alert("Vui lòng điền đầy đủ Email và Mật khẩu (bắt buộc khi tạo mới).");
      return;
    }

    let userData = { email, role, status };
    if (password) {
      userData.password = password; // Backend sẽ hash nó
    }

    let method = "POST";
    let url = `${BACKEND_API_URL}/admin/users`;
    let successMsg = "Tạo người dùng thành công!";

    if (editingUserId) {
      method = "PUT";
      url = `${BACKEND_API_URL}/admin/users/${editingUserId}`;
      successMsg = "Cập nhật tài khoản thành công!";
    }

    // 2. Gửi API
    const response = await authenticatedFetch(url, {
      method: method,
      body: JSON.stringify(userData),
    });

    // 3. Xử lý phản hồi
    if (response && response.ok) {
      alert(successMsg);
      closeUserModal();
      loadUsers(); // Tải lại bảng người dùng
    } else if (response) {
      const errorData = await response.json();
      alert(`Lỗi: ${errorData.msg || "Không thể lưu người dùng."}`);
    }
  }

  async function handleDeleteUser(id) {
    if (
      confirm(
        `Bạn có chắc chắn muốn xóa tài khoản ID ${id} không? Hành động này không thể hoàn tác.`
      )
    ) {
      const url = `${BACKEND_API_URL}/admin/users/${id}`;
      const response = await authenticatedFetch(url, { method: "DELETE" });

      if (response && response.ok) {
        alert(`Đã xóa tài khoản ID ${id} thành công.`);
        loadUsers(); // Tải lại bảng
      } else if (response) {
        const errorData = await response.json();
        alert(`Lỗi khi xóa: ${errorData.msg || "Không thể xóa người dùng."}`);
      }
    }
  }

  function handleTableActions(e) {
    const target = e.target.closest("button");
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;

    if (action === "edit") {
      // Tạm thời: Tải lại toàn bộ dữ liệu người dùng và tìm người cần sửa
      (async () => {
        const response = await authenticatedFetch(
          `${BACKEND_API_URL}/admin/users`
        );
        if (response && response.ok) {
          const data = await response.json();
          const userToEdit = data.users.find((u) => u._id === id);
          if (userToEdit) {
            openUserModal(userToEdit);
          } else {
            alert("Không tìm thấy người dùng để sửa.");
          }
        }
      })();
    } else if (action === "delete") {
      handleDeleteUser(id);
    }
  }

  // --- SIDEBAR HANDLERS ---
  function openSidebar() {
    if (!elements.adminSidebar) return;
    elements.adminSidebar.classList.remove("hidden");
    elements.sidebarOverlay.classList.remove("hidden");
  }

  function closeSidebar() {
    if (!elements.adminSidebar) return;
    elements.adminSidebar.classList.add("hidden");
    elements.sidebarOverlay.classList.add("hidden");
  }

  // --- PAGE NAVIGATION ---
  function handlePageNavigation(e) {
    e.preventDefault();
    const target = e.target.closest(".nav-link");
    if (!target) return;

    const page = target.dataset.page;
    if (!page) return;

    // Cập nhật trạng thái active cho link
    elements.navLinks.forEach((link) => link.classList.remove("active"));
    target.classList.add("active");

    // Hiển thị trang tương ứng
    elements.adminPages.forEach((p) => {
      if (p.id === `page-${page}`) {
        p.classList.add("active-page");
      } else {
        p.classList.remove("active-page");
      }
    });

    // Tự động đóng sidebar sau khi chọn
    closeSidebar();

    // Nếu chuyển sang trang users, tải lại dữ liệu
    if (page === "users") {
      loadUsers();
    }
  }

  // --- SEARCH HANDLER ---
  function handleSearchUser() {
    const query = elements.searchUserInput.value.trim();
    loadUsers(query);
  }

  // --- CONFIG HANDLERS (Giả lập) ---
  function handleSaveGeneralConfig(e) {
    e.preventDefault();
    // TODO: GỌI API ADMIN/CONFIG/GENERAL (PUT)
    const siteName = document.getElementById("site-name").value;
    alert(`Đã lưu cấu hình chung: Tên ứng dụng là "${siteName}" (giả lập).`);
  }

  function handleSendNotification(e) {
    e.preventDefault();
    // TODO: GỌI API ADMIN/CONFIG/NOTIFICATION (POST)
    const subject = document.getElementById("notification-subject").value;
    alert(`Thông báo đã được gửi với tiêu đề: "${subject}" (giả lập).`);
    elements.configNotificationForm.reset();
  }

  function handleBackup() {
    // TODO: GỌI API ADMIN/DATA/BACKUP (POST)
    alert("Đang tạo bản sao lưu dữ liệu (giả lập)... Hoàn tất!");
  }

  function handleRestore() {
    if (
      confirm(
        "CẢNH BÁO: Việc này sẽ ghi đè dữ liệu. Bạn có chắc chắn muốn khôi phục không?"
      )
    ) {
      // TODO: GỌI API ADMIN/DATA/RESTORE (POST)
      alert("Đang khôi phục dữ liệu từ bản sao lưu (giả lập)... Hoàn tất!");
    }
  }

  // --- EVENT LISTENERS ---
  function setupEventListeners() {
    // Sidebar
    if (elements.menuToggleBtn) {
      elements.menuToggleBtn.addEventListener("click", openSidebar);
    }
    if (elements.closeSidebarBtn) {
      elements.closeSidebarBtn.addEventListener("click", closeSidebar);
    }
    if (elements.sidebarOverlay) {
      elements.sidebarOverlay.addEventListener("click", closeSidebar);
    }
    if (elements.sidebarNav) {
      elements.sidebarNav.addEventListener("click", handlePageNavigation);
    }

    // User Management
    if (elements.userTableBody) {
      elements.userTableBody.addEventListener("click", handleTableActions);
    }
    if (elements.addNewUserBtn) {
      elements.addNewUserBtn.addEventListener("click", () =>
        openUserModal(null)
      );
    }

    // Modal
    if (elements.closeUserModalBtn) {
      elements.closeUserModalBtn.addEventListener("click", closeUserModal);
    }
    if (elements.cancelUserModalBtn) {
      elements.cancelUserModalBtn.addEventListener("click", closeUserModal);
    }
    if (elements.userForm) {
      elements.userForm.addEventListener("submit", handleSaveUser);
    }

    // Search
    if (elements.searchUserBtn) {
      elements.searchUserBtn.addEventListener("click", handleSearchUser);
    }
    if (elements.searchUserInput) {
      elements.searchUserInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleSearchUser();
        }
      });
    }

    // Config (Giữ nguyên các handlers giả lập)
    if (elements.configGeneralForm) {
      elements.configGeneralForm.addEventListener(
        "submit",
        handleSaveGeneralConfig
      );
    }
    if (elements.configNotificationForm) {
      elements.configNotificationForm.addEventListener(
        "submit",
        handleSendNotification
      );
    }
    if (elements.backupBtn) {
      elements.backupBtn.addEventListener("click", handleBackup);
    }
    if (elements.restoreBtn) {
      elements.restoreBtn.addEventListener("click", handleRestore);
    }

    // Logout
    if (elements.logoutBtnAdmin) {
      elements.logoutBtnAdmin.addEventListener("click", handleLogout);
    }
  }

  // --- INITIALIZATION ---
  async function init() {
    // BƯỚC 1: Kiểm tra quyền Admin trước khi hiển thị bất cứ điều gì
    const hasAccess = await checkAdminAccess();
    if (!hasAccess) return;

    // BƯỚC 2: Tải dữ liệu mặc định (Trang Users)
    loadUsers();

    // BƯỚC 3: Thiết lập Listeners
    setupEventListeners();
  }

  init();
});
// --- END OF FILE admin.js ---
