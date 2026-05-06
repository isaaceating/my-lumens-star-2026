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
  updateDoc,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// TODO: 換成你 Firebase Console 裡的完整 config
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

// DOM
const adminLoginButton = document.getElementById("adminLoginButton");
const adminLogoutButton = document.getElementById("adminLogoutButton");
const adminUserStatus = document.getElementById("adminUserStatus");
const adminAccessStatus = document.getElementById("adminAccessStatus");
const adminContent = document.getElementById("adminContent");
const adminContestantsTable = document.getElementById("adminContestantsTable");
const refreshAdminDataButton = document.getElementById("refreshAdminDataButton");

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
// Login
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
  if (!isCurrentUserAdmin) return;
  await loadContestantsForAdmin();
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  isCurrentUserAdmin = false;

  if (!user) {
    adminUserStatus.textContent = "尚未登入";
    adminAccessStatus.textContent = "";
    adminLoginButton.classList.remove("hidden");
    adminLogoutButton.classList.add("hidden");
    adminContent.classList.add("hidden");
    return;
  }

  adminUserStatus.textContent = `已登入：${user.email}`;
  adminLoginButton.classList.add("hidden");
  adminLogoutButton.classList.remove("hidden");

  console.log("Admin user:", user.email);
  console.log("Admin UID:", user.uid);

  const adminResult = await checkAdmin(user.uid);

  if (!adminResult) {
    adminAccessStatus.textContent = "你目前不是管理員，無法使用此頁面。";
    adminContent.classList.add("hidden");
    return;
  }

  isCurrentUserAdmin = true;
  adminAccessStatus.textContent = "管理員驗證成功。";
  adminContent.classList.remove("hidden");

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

// -----------------------------
// Load Contestants
// -----------------------------
async function loadContestantsForAdmin() {
  try {
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

      return `
        <tr>
          <td>
            <img
              class="admin-photo"
              src="${escapeHtml(contestant.photoUrl)}"
              alt="${escapeHtml(contestant.name || "")}"
            />
          </td>

          <td>
            <span class="status-badge ${statusClass}">
              ${statusLabel}
            </span>
          </td>

          <td>
            <input
              class="admin-order-input"
              type="number"
              value="${manualOrder}"
              data-id="${contestant.id}"
            />
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
            <div class="admin-row-actions">
              <button
                class="edit-contestant-button admin-edit-button"
                data-id="${contestant.id}"
              >
                編輯
              </button>

              <button
                class="toggle-publish-button"
                data-id="${contestant.id}"
                data-current="${isPublished}"
              >
                ${isPublished ? "隱藏" : "公開"}
              </button>

              <button
                class="save-order-button secondary-button"
                data-id="${contestant.id}"
              >
                儲存排序
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  bindAdminRowEvents();
}

function bindAdminRowEvents() {
  document.querySelectorAll(".edit-contestant-button").forEach((button) => {
    button.addEventListener("click", () => {
      const contestantId = button.dataset.id;
      openEditModal(contestantId);
    });
  });

  document.querySelectorAll(".toggle-publish-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const contestantId = button.dataset.id;
      const currentStatus = button.dataset.current === "true";

      await togglePublishStatus(contestantId, !currentStatus);
    });
  });

  document.querySelectorAll(".save-order-button").forEach((button) => {
    button.addEventListener("click", async () => {
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

  if (!isCurrentUserAdmin) {
    alert("你不是管理員，無法更新資料。");
    return;
  }

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
    editMessage.textContent = "請完整填寫姓名、部門、工號與表演項目。";
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

console.log("Admin page v1.3 loaded.");