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
  setDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";

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
const storage = getStorage(app);

const provider = new GoogleAuthProvider();

let currentUser = null;

// DOM
const loginButton = document.getElementById("loginButton");
const logoutButton = document.getElementById("logoutButton");
const userStatus = document.getElementById("userStatus");

const registrationForm = document.getElementById("registrationForm");
const registrationMessage = document.getElementById("registrationMessage");
const contestantsGrid = document.getElementById("contestantsGrid");

// 活動設定
const REGISTRATION_DEADLINE = new Date("2026-06-15T23:59:59+08:00");

// -----------------------------
// Google Login
// -----------------------------
loginButton.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Login failed:", error);
    alert(`Google 登入失敗：${error.code}\n${error.message}`);
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Logout failed:", error);
    alert(`登出失敗：${error.code}\n${error.message}`);
  }
});

onAuthStateChanged(auth, (user) => {
  currentUser = user;

  if (user) {
    userStatus.textContent = `已登入：${user.email}`;
    loginButton.classList.add("hidden");
    logoutButton.classList.remove("hidden");

    console.log("User logged in:", user.email);
  } else {
    userStatus.textContent = "尚未登入";
    loginButton.classList.remove("hidden");
    logoutButton.classList.add("hidden");

    console.log("User logged out");
  }
});

// -----------------------------
// 報名送出
// -----------------------------
registrationForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    if (!currentUser) {
      alert("請先使用 Google 登入後再報名。");
      return;
    }

    const now = new Date();

    if (now > REGISTRATION_DEADLINE) {
      registrationMessage.textContent = "報名已截止。";
      return;
    }

    const department = document.getElementById("department").value.trim();
    const employeeId = document.getElementById("employeeId").value.trim();
    const name = document.getElementById("name").value.trim();
    const stageName = document.getElementById("stageName").value.trim();
    const performanceItem = document.getElementById("performanceItem").value.trim();
    const photoFile = document.getElementById("photo").files[0];
    const photoConsent = document.getElementById("photoConsent").checked;

    if (!department || !employeeId || !name || !performanceItem || !photoFile) {
      registrationMessage.textContent = "請完整填寫所有必填欄位。";
      return;
    }

    if (!photoConsent) {
      registrationMessage.textContent = "請勾選照片使用同意。";
      return;
    }

    if (!photoFile.type.startsWith("image/")) {
      registrationMessage.textContent = "請上傳 JPG 或 PNG 圖片。";
      return;
    }

    if (photoFile.size > 5 * 1024 * 1024) {
      registrationMessage.textContent = "圖片大小不可超過 5MB。";
      return;
    }

    setFormLoading(true, "報名資料上傳中，請稍候...");

    // 先產生 Firestore 文件 ID
    const contestantRef = doc(collection(db, "contestants"));
    const contestantId = contestantRef.id;

    // 準備照片路徑
    const fileExtension = getFileExtension(photoFile.name);
    const safeFileName = `${contestantId}_${Date.now()}.${fileExtension}`;
    const photoPath = `contestant_photos/${safeFileName}`;

    // 上傳照片到 Firebase Storage
    const photoRef = ref(storage, photoPath);
    await uploadBytes(photoRef, photoFile);

    // 取得照片公開網址
    const photoUrl = await getDownloadURL(photoRef);

    // 寫入 Firestore
    const contestantData = {
      contestantId,
      department,
      employeeId,
      name,
      stageName: stageName || "",
      performanceItem,
      photoUrl,
      photoPath,
      publishStatus: false,
      manualOrder: 999,
      voteCount: 0,
      registerTime: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdBy: currentUser.email,
      createdByUid: currentUser.uid
    };

    await setDoc(contestantRef, contestantData);

    registrationForm.reset();
    registrationMessage.textContent = "報名成功！資料將由福委會審核後公開顯示。";

    console.log("Registration success:", contestantId);
  } catch (error) {
    console.error("Registration failed:", error);
    registrationMessage.textContent = `報名失敗：${error.code || ""} ${error.message || ""}`;
  } finally {
    setFormLoading(false);
  }
});

// -----------------------------
// 讀取已公開選手卡片
// -----------------------------
function listenToPublishedContestants() {
  const contestantsRef = collection(db, "contestants");
  const q = query(contestantsRef, where("publishStatus", "==", true));

  onSnapshot(
    q,
    (snapshot) => {
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

        if (orderA !== orderB) {
          return orderA - orderB;
        }

        const timeA = a.registerTime?.seconds || 0;
        const timeB = b.registerTime?.seconds || 0;

        return timeA - timeB;
      });

      renderContestants(contestants);
    },
    (error) => {
      console.error("Load contestants failed:", error);
      contestantsGrid.innerHTML = `
        <p class="message">選手資料讀取失敗，請稍後再試。</p>
      `;
    }
  );
}

function renderContestants(contestants) {
  if (!contestants.length) {
    contestantsGrid.innerHTML = `
      <p class="message">目前尚無已公開的參賽選手。</p>
    `;
    return;
  }

  contestantsGrid.innerHTML = contestants
    .map((contestant, index) => {
      const number = String(index + 1).padStart(2, "0");
      const stageName = contestant.stageName
        ? `A.K.A. ${escapeHtml(contestant.stageName)}`
        : "A.K.A. —";

      return `
        <article class="contestant-card">
          <img
            class="contestant-photo"
            src="${escapeHtml(contestant.photoUrl)}"
            alt="${escapeHtml(contestant.name)}"
          />

          <div class="contestant-body">
            <div class="contestant-number">No. ${number}</div>
            <h3 class="contestant-name">${escapeHtml(contestant.name)}</h3>
            <p class="contestant-stage">${stageName}</p>
            <p class="contestant-performance">
              ${escapeHtml(contestant.performanceItem)}
            </p>

            <div class="vote-row">
              <span class="vote-count">人氣票數：${contestant.voteCount || 0}</span>
              <button class="vote-button" data-id="${contestant.id}">
                人氣應援
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  // 投票功能下一步才正式接，這裡先防止按鈕沒反應
  document.querySelectorAll(".vote-button").forEach((button) => {
    button.addEventListener("click", () => {
      alert("投票功能下一步開發。現在先測試報名與選手卡片顯示。");
    });
  });
}

// -----------------------------
// 工具函式
// -----------------------------
function setFormLoading(isLoading, message = "") {
  const submitButton = registrationForm.querySelector("button[type='submit']");

  if (isLoading) {
    submitButton.disabled = true;
    submitButton.textContent = "上傳中...";
    registrationMessage.textContent = message;
  } else {
    submitButton.disabled = false;
    submitButton.textContent = "送出報名";
  }
}

function getFileExtension(fileName) {
  const parts = fileName.split(".");
  const ext = parts.length > 1 ? parts.pop().toLowerCase() : "jpg";

  if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
    return ext;
  }

  return "jpg";
}

function escapeHtml(value) {
  if (value === undefined || value === null) return "";

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// 啟動
listenToPublishedContestants();

console.log("Firebase connected successfully.");