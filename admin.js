import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBlj362N4O6ERqgFziQ4Gg9W7SEyquKb0g",
  authDomain: "my-lumens-star-2026.firebaseapp.com",
  projectId: "my-lumens-star-2026",
  storageBucket: "my-lumens-star-2026.firebasestorage.app",
  messagingSenderId: "150108062917",
  appId: "1:150108062917:web:f7284392bed27438041cac"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let currentUser = null;
let isCurrentUserAdmin = false;
let adminContestantsCache = [];
let isRegistrationToggleBusy = false;

const REGISTRATION_AUTO_CLOSE_TIME = new Date("2026-06-01T00:00:00+08:00");

let registrationSettingsCache = {
  isOpen: null,
  isAutoClosed: false,
  exists: false
};

// DOM
const adminLoginButton = document.getElementById("adminLoginButton");
const adminLogoutButton = document.getElementById("adminLogoutButton");
const adminUserStatus = document.getElementById("adminUserStatus");
const adminAccessStatus = document.getElementById("adminAccessStatus");
const adminContent = document.getElementById("adminContent");
const adminContestantsTable = document.getElementById("adminContestantsTable");
const refreshAdminDataButton = document.getElementById("refreshAdminDataButton");

const registrationStatusText = document.getElementById("registrationStatusText");
const registrationSettingsMessage = document.getElementById("registrationSettingsMessage");
const toggleRegistrationButton = document.getElementById("toggleRegistrationButton");

// Edit Modal DOM
const editModal = document.getElementById("editModal");
const editContestantForm = document.getElementById("editContestantForm");
const closeEditModalButton = document.getElementById("closeEditModalButton");
const cancelEditButton = document.getElementById("cancelEditButton");
const editMessage = document.getElementById("editMessage");

const editContestantId = document.getElementById("editContestantId");
const editName = document.getElementById("editName");
const editStageName = document.getElementById("editStageName");
const editDepartment = document.getElementById("editDepartment");
const editEmployeeId = document.getElementById("editEmployeeId");
const editPerformanceItem = document.getElementById("editPerformanceItem");
const editManualOrder = document.getElementById("editManualOrder");

// -----------------------------
// Login / Logout
// -----------------------------
adminLoginButton.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Admin login failed:", error);
    alert(`登入失敗：${error.code}\n${error.message}`);
  }
});

adminLogoutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Admin logout failed:", error);
    alert(`登出失敗：${error.code}\n${error.message}`);
  }
});

refreshAdminDataButton.addEventListener("click", async () => {
  await loadRegistrationSettings();
  await loadContestantsForAdmin();
});

toggleRegistrationButton.addEventListener("click", async () => {
  await toggleRegistrationStatus();
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  isCurrentUserAdmin = false;

  adminContent.classList.remove("hidden");

  // 重要：報名頁會建立 Anonymous Auth。
  // 如果 Admin 頁吃到匿名登入，會導致 Google 登入按鈕消失、Admin 驗證失敗。
  if (user && user.isAnonymous) {
    adminUserStatus.textContent = "偵測到匿名報名身份，正在切換為管理員登入模式...";
    adminAccessStatus.textContent = "請使用 Google Admin 帳號登入。";
    adminLoginButton.classList.remove("hidden");
    adminLogoutButton.classList.add("hidden");

    try {
      await signOut(auth);
    } catch (error) {
      console.warn("Anonymous admin sign out failed:", error);
    }

    await loadRegistrationSettings();
    await loadContestantsForAdmin();
    return;
  }

  if (!user) {
    adminUserStatus.textContent = "尚未登入";
    adminAccessStatus.textContent = "目前為瀏覽模式。登入並具備管理員權限後，才可以編輯資料。";
    adminLoginButton.classList.remove("hidden");
    adminLogoutButton.classList.add("hidden");

    await loadRegistrationSettings();
    await loadContestantsForAdmin();
    return;
  }

  adminUserStatus.textContent = `已登入：${user.email || "未知帳號"}`;
  adminLoginButton.classList.add("hidden");
  adminLogoutButton.classList.remove("hidden");

  const adminResult = await checkAdmin(user.uid);

  if (!adminResult) {
    adminAccessStatus.textContent = "目前為瀏覽模式。此帳號沒有管理員權限，無法編輯資料。";
    isCurrentUserAdmin = false;

    await loadRegistrationSettings();
    await loadContestantsForAdmin();
    return;
  }

  isCurrentUserAdmin = true;
  adminAccessStatus.textContent = "管理員模式已啟用，可以編輯資料。";

  await loadRegistrationSettings();
  await loadContestantsForAdmin();
});

// -----------------------------
// Admin Check
// -----------------------------
async function checkAdmin(uid) {
  try {
    const adminRef = doc(db, "admins", uid);
    const adminSnap = await getDoc(adminRef);

    if (!adminSnap.exists()) {
      return false;
    }

    const data = adminSnap.data();
    return data.role === "admin";
  } catch (error) {
    console.error("Check admin failed:", error);
    adminAccessStatus.textContent = `管理員驗證失敗：${error.message}`;
    return false;
  }
}

function requireAdminPermission() {
  if (!currentUser) {
    alert("請先使用 Google 登入。");
    return false;
  }

  if (currentUser.isAnonymous) {
    alert("目前是匿名報名身份，請先登出後使用 Google Admin 帳號登入。");
    return false;
  }

  if (!isCurrentUserAdmin) {
    alert("此帳號沒有管理員權限，無法編輯資料。");
    return false;
  }

  return true;
}

// -----------------------------
// Registration Settings
// -----------------------------
async function getRegistrationSettingsFromFirestore() {
  const settingsRef = doc(db, "settings", "registration");
  const settingsSnap = await getDoc(settingsRef);

  const now = new Date();
  const isPastAutoCloseTime = now >= REGISTRATION_AUTO_CLOSE_TIME;

  if (settingsSnap.exists()) {
    const data = settingsSnap.data();

    return {
      isOpen: data.isOpen === true,
      isAutoClosed: false,
      exists: true
    };
  }

  return {
    isOpen: !isPastAutoCloseTime,
    isAutoClosed: isPastAutoCloseTime,
    exists: false
  };
}

async function loadRegistrationSettings() {
  try {
    if (!registrationStatusText || !toggleRegistrationButton) return;

    registrationStatusText.textContent = "報名狀態讀取中...";
    toggleRegistrationButton.textContent = "讀取中...";

    registrationSettingsCache = await getRegistrationSettingsFromFirestore();

    renderRegistrationSettings();
  } catch (error) {
    console.error("Load registration settings failed:", error);

    if (registrationStatusText) {
      registrationStatusText.textContent = `報名狀態讀取失敗：${error.message}`;
    }

    if (toggleRegistrationButton) {
      toggleRegistrationButton.textContent = "重新讀取失敗";
    }

    if (registrationSettingsMessage) {
      registrationSettingsMessage.textContent = "請確認 Firestore Rules 與 settings/registration 是否設定正確。";
    }
  }
}

function renderRegistrationSettings() {
  const isOpen = registrationSettingsCache.isOpen === true;

  if (registrationStatusText) {
    registrationStatusText.textContent = isOpen
      ? "目前狀態：報名開放中"
      : "目前狀態：報名已關閉";
  }

  if (toggleRegistrationButton) {
    if (isRegistrationToggleBusy) {
      toggleRegistrationButton.textContent = "更新中...";
    } else {
      toggleRegistrationButton.textContent = isOpen ? "關閉報名" : "開啟報名";
    }
  }

  if (registrationSettingsMessage) {
    if (!isCurrentUserAdmin) {
      registrationSettingsMessage.textContent = "只有 Admin 可以手動開啟或關閉報名。";
    } else if (registrationSettingsCache.isAutoClosed) {
      registrationSettingsMessage.textContent = "目前因超過 2026/6/1 00:00，系統已自動視為報名截止。Admin 可手動重新開啟。";
    } else {
      registrationSettingsMessage.textContent = "";
    }
  }
}

async function toggleRegistrationStatus() {
  if (isRegistrationToggleBusy) return;

  if (!requireAdminPermission()) {
    await loadRegistrationSettings();
    return;
  }

  try {
    isRegistrationToggleBusy = true;
    renderRegistrationSettings();

    const latestSettings = await getRegistrationSettingsFromFirestore();
    const currentStatus = latestSettings.isOpen === true;
    const nextStatus = !currentStatus;
    const actionText = nextStatus ? "開啟" : "關閉";

    const confirmed = confirm(`確定要${actionText}報名嗎？`);

    if (!confirmed) {
      registrationSettingsCache = latestSettings;
      isRegistrationToggleBusy = false;
      renderRegistrationSettings();
      return;
    }

    const settingsRef = doc(db, "settings", "registration");

    await setDoc(settingsRef, {
      isOpen: nextStatus,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email || "",
      updatedByUid: currentUser.uid
    }, { merge: true });

    registrationSettingsCache = await getRegistrationSettingsFromFirestore();

    alert(`報名已${nextStatus ? "開啟" : "關閉"}。`);
  } catch (error) {
    console.error("Toggle registration status failed:", error);
    alert(`更新報名狀態失敗：${error.code || ""} ${error.message || ""}`);
  } finally {
    isRegistrationToggleBusy = false;
    await loadRegistrationSettings();
  }
}

// -----------------------------
// Load Contestants
// -----------------------------
async function loadContestantsForAdmin() {
  try {
    adminContent.classList.remove("hidden");

    adminContestantsTable.innerHTML = `
      <tr>
        <td colspan="8">資料讀取中...</td>
      </tr>
    `;

    const contestantsRef = collection(db, "contestants");
    const q = query(contestantsRef, orderBy("manualOrder", "asc"));
    const snapshot = await getDocs(q);

    const contestants = [];

    snapshot.forEach((docSnap) => {
      contestants.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    contestants.sort((a, b) => {
      const orderA = typeof a.manualOrder === "number" ? a.manualOrder : 999;
      const orderB = typeof b.manualOrder === "number" ? b.manualOrder : 999;

      if (orderA !== orderB) return orderA - orderB;

      const timeA = a.registerTime?.seconds || 0;
      const timeB = b.registerTime?.seconds || 0;

      return timeA - timeB;
    });

    adminContestantsCache = contestants;
    renderAdminContestants(contestants);
  } catch (error) {
    console.error("Load admin contestants failed:", error);

    adminContestantsTable.innerHTML = `
      <tr>
        <td colspan="8">資料讀取失敗：${escapeHtml(error.message)}</td>
      </tr>
    `;
  }
}

function renderAdminContestants(contestants) {
  if (!contestants.length) {
    adminContestantsTable.innerHTML = `
      <tr>
        <td colspan="8">目前尚無報名資料</td>
      </tr>
    `;
    return;
  }

  adminContestantsTable.innerHTML = contestants
    .map((contestant) => {
      const isPublished = contestant.publishStatus === true;
      const statusLabel = isPublished ? "已公開" : "未公開";
      const statusClass = isPublished ? "status-published" : "status-hidden";

      const stageName = contestant.stageName ? contestant.stageName : "—";
      const manualOrder = typeof contestant.manualOrder === "number"
        ? contestant.manualOrder
        : 999;

      const voteCount = contestant.voteCount || 0;

      const orderCell = isCurrentUserAdmin
        ? `
          <input
            class="admin-order-input"
            type="number"
            value="${manualOrder}"
            data-id="${contestant.id}"
          />
        `
        : `
          <span>${manualOrder}</span>
        `;

      const actionCell = isCurrentUserAdmin
        ? `
          <div class="admin-row-actions">
            <button
              type="button"
              class="edit-contestant-button admin-edit-button"
              data-id="${contestant.id}"
            >
              編輯
            </button>

            <button
              type="button"
              class="toggle-publish-button"
              data-id="${contestant.id}"
              data-current="${isPublished}"
            >
              ${isPublished ? "隱藏" : "公開"}
            </button>

            <button
              type="button"
              class="save-order-button secondary-button"
              data-id="${contestant.id}"
            >
              儲存排序
            </button>
          </div>
        `
        : `
          <span class="admin-small-text">僅管理員可編輯</span>
        `;

      return `
        <tr>
          <td>
            <img
              class="admin-photo"
              src="${escapeHtml(contestant.photoUrl || "")}"
              alt="${escapeHtml(contestant.name || "")}"
            />
          </td>

          <td>
            <span class="status-badge ${statusClass}">
              ${statusLabel}
            </span>
          </td>

          <td>
            ${orderCell}
          </td>

          <td>
            <strong>${escapeHtml(contestant.name || "")}</strong>
            <div class="admin-small-text">A.K.A. ${escapeHtml(stageName)}</div>
          </td>

          <td>
            ${escapeHtml(contestant.department || "")}
            <div class="admin-small-text">工號：${escapeHtml(contestant.employeeId || "")}</div>
          </td>

          <td>
            ${escapeHtml(contestant.performanceItem || "")}
          </td>

          <td>
            ${voteCount}
          </td>

          <td>
            ${actionCell}
          </td>
        </tr>
      `;
    })
    .join("");

  bindAdminRowEvents();
}

function bindAdminRowEvents() {
  if (!isCurrentUserAdmin) return;

  document.querySelectorAll(".edit-contestant-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (!requireAdminPermission()) return;

      const contestantId = button.dataset.id;
      openEditModal(contestantId);
    });
  });

  document.querySelectorAll(".toggle-publish-button").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!requireAdminPermission()) return;

      const contestantId = button.dataset.id;
      const currentStatus = button.dataset.current === "true";

      await togglePublishStatus(contestantId, !currentStatus);
    });
  });

  document.querySelectorAll(".save-order-button").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!requireAdminPermission()) return;

      const contestantId = button.dataset.id;
      const input = document.querySelector(`.admin-order-input[data-id="${contestantId}"]`);

      if (!input) return;

      const value = Number(input.value);

      if (Number.isNaN(value)) {
        alert("排序請輸入數字。");
        return;
      }

      await updateManualOrder(contestantId, value);
    });
  });
}

// -----------------------------
// Edit Modal
// -----------------------------
function openEditModal(contestantId) {
  if (!requireAdminPermission()) return;

  const contestant = adminContestantsCache.find((item) => item.id === contestantId);

  if (!contestant) {
    alert("找不到這位選手資料，請重新整理後再試。");
    return;
  }

  editContestantId.value = contestant.id;
  editName.value = contestant.name || "";
  editStageName.value = contestant.stageName || "";
  editDepartment.value = contestant.department || "";
  editEmployeeId.value = contestant.employeeId || "";
  editPerformanceItem.value = contestant.performanceItem || "";
  editManualOrder.value = typeof contestant.manualOrder === "number"
    ? contestant.manualOrder
    : 999;

  editMessage.textContent = "";
  editModal.classList.remove("hidden");
}

function closeEditModal() {
  editModal.classList.add("hidden");
  editContestantForm.reset();
  editMessage.textContent = "";
}

closeEditModalButton.addEventListener("click", closeEditModal);
cancelEditButton.addEventListener("click", closeEditModal);

editModal.addEventListener("click", (event) => {
  if (event.target === editModal) {
    closeEditModal();
  }
});

editContestantForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!requireAdminPermission()) return;

  const contestantId = editContestantId.value;
  const name = editName.value.trim();
  const stageName = editStageName.value.trim();
  const department = editDepartment.value.trim();
  const employeeId = editEmployeeId.value.trim();
  const performanceItem = editPerformanceItem.value.trim();
  const manualOrder = Number(editManualOrder.value);

  if (!contestantId) {
    editMessage.textContent = "找不到選手 ID。";
    return;
  }

  if (!name || !department || !employeeId || !performanceItem) {
    editMessage.textContent = "請完整填寫姓名、部門、工號與演唱歌曲。";
    return;
  }

  if (Number.isNaN(manualOrder)) {
    editMessage.textContent = "排序請輸入數字。";
    return;
  }

  try {
    const submitButton = editContestantForm.querySelector("button[type='submit']");
    submitButton.disabled = true;
    submitButton.textContent = "儲存中...";
    editMessage.textContent = "資料儲存中...";

    const contestantRef = doc(db, "contestants", contestantId);

    await updateDoc(contestantRef, {
      name,
      stageName,
      department,
      employeeId,
      performanceItem,
      manualOrder,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email,
      updatedByUid: currentUser.uid
    });

    editMessage.textContent = "儲存成功。";

    await loadContestantsForAdmin();

    setTimeout(() => {
      closeEditModal();
    }, 500);
  } catch (error) {
    console.error("Update contestant failed:", error);
    editMessage.textContent = `儲存失敗：${error.message}`;
  } finally {
    const submitButton = editContestantForm.querySelector("button[type='submit']");
    submitButton.disabled = false;
    submitButton.textContent = "儲存修改";
  }
});

// -----------------------------
// Update Actions
// -----------------------------
async function togglePublishStatus(contestantId, nextStatus) {
  if (!requireAdminPermission()) return;

  try {
    const label = nextStatus ? "公開" : "隱藏";
    const confirmed = confirm(`確定要${label}這位選手嗎？`);

    if (!confirmed) return;

    const contestantRef = doc(db, "contestants", contestantId);

    await updateDoc(contestantRef, {
      publishStatus: nextStatus,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email,
      updatedByUid: currentUser.uid
    });

    await loadContestantsForAdmin();

    alert(`${label}成功。`);
  } catch (error) {
    console.error("Toggle publish failed:", error);
    alert(`更新公開狀態失敗：${error.message}`);
  }
}

async function updateManualOrder(contestantId, manualOrder) {
  if (!requireAdminPermission()) return;

  try {
    const contestantRef = doc(db, "contestants", contestantId);

    await updateDoc(contestantRef, {
      manualOrder,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email,
      updatedByUid: currentUser.uid
    });

    await loadContestantsForAdmin();

    alert("排序更新成功。");
  } catch (error) {
    console.error("Update order failed:", error);
    alert(`排序更新失敗：${error.message}`);
  }
}

// -----------------------------
// Utils
// -----------------------------
function escapeHtml(value) {
  if (value === undefined || value === null) return "";

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

console.log("Admin page v1.6 registration-control-stable loaded.");