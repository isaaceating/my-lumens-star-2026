import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";

import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";

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

let currentUser = null;
let anonymousAuthReady = false;
let registrationIsOpen = false;

const REGISTRATION_AUTO_CLOSE_TIME = new Date("2026-06-01T00:00:00+08:00");

// DOM
const registrationForm = document.getElementById("registrationForm");
const registrationMessage = document.getElementById("registrationMessage");

// Live preview DOM
const previewDepartment = document.getElementById("previewDepartment");
const previewName = document.getElementById("previewName");
const previewStageName = document.getElementById("previewStageName");
const previewPerformanceItem = document.getElementById("previewPerformanceItem");
const previewPhoto = document.getElementById("previewPhoto");
const previewPhotoPlaceholder = document.getElementById("previewPhotoPlaceholder");

let previewPhotoObjectUrl = null;

// -----------------------------
// Registration Status
// -----------------------------
async function getRegistrationStatus() {
  try {
    const settingsRef = doc(db, "settings", "registration");
    const settingsSnap = await getDoc(settingsRef);

    if (settingsSnap.exists()) {
      const data = settingsSnap.data();

      return {
        isOpen: data.isOpen === true,
        source: "admin"
      };
    }

    const now = new Date();

    return {
      isOpen: now < REGISTRATION_AUTO_CLOSE_TIME,
      source: "auto"
    };
  } catch (error) {
    console.error("Load registration status failed:", error);

    const now = new Date();

    return {
      isOpen: now < REGISTRATION_AUTO_CLOSE_TIME,
      source: "fallback"
    };
  }
}

async function initRegistrationStatus() {
  registrationMessage.textContent = "報名狀態讀取中...";

  const status = await getRegistrationStatus();
  registrationIsOpen = status.isOpen;

  applyRegistrationFormStatus();

  if (registrationIsOpen) {
    registrationMessage.textContent = "";
  }
}

function applyRegistrationFormStatus() {
  const submitButton = registrationForm.querySelector("button[type='submit']");
  const fields = registrationForm.querySelectorAll("input, button");

  if (registrationIsOpen) {
    fields.forEach((field) => {
      field.disabled = false;
    });

    submitButton.textContent = "送出報名";
    return;
  }

  fields.forEach((field) => {
    field.disabled = true;
  });

  submitButton.textContent = "報名已截止";
  registrationMessage.textContent = "報名已截止。如需特殊處理，請洽福委會管理員。";
}

// -----------------------------
// Anonymous Auth for Registration
// -----------------------------
async function initAnonymousAuth() {
  try {
    if (registrationIsOpen) {
      registrationMessage.textContent = "報名系統初始化中...";
    }

    await signInAnonymously(auth);
  } catch (error) {
    console.error("Anonymous sign-in failed:", error);
    registrationMessage.textContent = `報名系統初始化失敗：${error.code || ""} ${error.message || ""}`;
  }
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;

  if (user) {
    anonymousAuthReady = true;

    if (registrationIsOpen) {
      registrationMessage.textContent = "";
    }

    console.log("Anonymous registration user ready:", user.uid);
  } else {
    anonymousAuthReady = false;
    console.log("Anonymous registration user not ready");
  }
});

// -----------------------------
// 選手卡片即時預覽
// -----------------------------
function initCardPreview() {
  const fields = [
    { id: "department", target: previewDepartment, fallback: "部門" },
    { id: "name", target: previewName, fallback: "姓名" },
    {
      id: "stageName",
      target: previewStageName,
      fallback: "A.K.A. 藝名",
      formatter: (value) => value ? `A.K.A. ${value}` : "A.K.A. 藝名"
    },
    { id: "performanceItem", target: previewPerformanceItem, fallback: "歌手 - 歌名" }
  ];

  fields.forEach(({ id, target, fallback, formatter }) => {
    const input = document.getElementById(id);
    if (!input || !target) return;

    const update = () => {
      const value = input.value.trim();
      target.textContent = formatter ? formatter(value) : (value || fallback);
    };

    input.addEventListener("input", update);
    update();
  });

  const photoInput = document.getElementById("photo");
  if (!photoInput || !previewPhoto || !previewPhotoPlaceholder) return;

  photoInput.addEventListener("change", () => {
    const file = photoInput.files[0];

    if (previewPhotoObjectUrl) {
      URL.revokeObjectURL(previewPhotoObjectUrl);
      previewPhotoObjectUrl = null;
    }

    if (!file || !file.type.startsWith("image/")) {
      previewPhoto.removeAttribute("src");
      previewPhoto.classList.remove("is-visible");
      previewPhotoPlaceholder.classList.remove("hidden");
      return;
    }

    previewPhotoObjectUrl = URL.createObjectURL(file);
    previewPhoto.src = previewPhotoObjectUrl;
    previewPhoto.classList.add("is-visible");
    previewPhotoPlaceholder.classList.add("hidden");
  });
}

// -----------------------------
// 報名送出
// -----------------------------
registrationForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const latestStatus = await getRegistrationStatus();
    registrationIsOpen = latestStatus.isOpen;

    if (!registrationIsOpen) {
      applyRegistrationFormStatus();
      registrationMessage.textContent = "報名已截止。";
      return;
    }

    if (!anonymousAuthReady || !currentUser) {
      registrationMessage.textContent = "報名系統尚未初始化完成，請稍候再試。";
      return;
    }

    const department = document.getElementById("department").value.trim();
    const employeeId = document.getElementById("employeeId").value.trim();
    const name = document.getElementById("name").value.trim();
    const stageName = document.getElementById("stageName").value.trim();
    const performanceItem = document.getElementById("performanceItem").value.trim();
    const photoFile = document.getElementById("photo").files[0];
    const photoConsent = document.getElementById("photoConsent").checked;

    if (!department || !employeeId || !name || !stageName || !performanceItem || !photoFile) {
      registrationMessage.textContent = "所有欄位皆為必填，請完整填寫。";
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

    const contestantRef = doc(collection(db, "contestants"));
    const contestantId = contestantRef.id;

    const fileExtension = getFileExtension(photoFile.name);
    const safeFileName = `${contestantId}_${Date.now()}.${fileExtension}`;
    const photoPath = `contestant_photos/${safeFileName}`;

    const photoRef = ref(storage, photoPath);
    await uploadBytes(photoRef, photoFile);

    const photoUrl = await getDownloadURL(photoRef);

    const contestantData = {
      contestantId,
      department,
      employeeId,
      name,
      stageName,
      performanceItem,
      photoUrl,
      photoPath,
      publishStatus: false,
      manualOrder: 999,
      voteCount: 0,
      registerTime: serverTimestamp(),
      createdAt: serverTimestamp(),

      // Anonymous registration tracking
      createdBy: "anonymous-registration",
      createdByUid: currentUser.uid,
      authProvider: "anonymous"
    };

    await setDoc(contestantRef, contestantData);

    registrationForm.reset();
    resetCardPreview();
    registrationMessage.textContent = "報名成功！資料將由福委會審核後公開顯示。";

    console.log("Registration success:", contestantId);
  } catch (error) {
    console.error("Registration failed:", error);
    registrationMessage.textContent = `報名失敗：${error.code || ""} ${error.message || ""}`;
  } finally {
    setFormLoading(false);
    applyRegistrationFormStatus();
  }
});

// -----------------------------
// Utils
// -----------------------------
function setFormLoading(isLoading, message = "") {
  const submitButton = registrationForm.querySelector("button[type='submit']");

  if (isLoading) {
    submitButton.disabled = true;
    submitButton.textContent = "上傳中...";
    registrationMessage.textContent = message;
  } else {
    submitButton.disabled = !registrationIsOpen;
    submitButton.textContent = registrationIsOpen ? "送出報名" : "報名已截止";
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

function resetCardPreview() {
  if (previewDepartment) previewDepartment.textContent = "部門";
  if (previewName) previewName.textContent = "姓名";
  if (previewStageName) previewStageName.textContent = "A.K.A. 藝名";
  if (previewPerformanceItem) previewPerformanceItem.textContent = "歌手 - 歌名";

  if (previewPhotoObjectUrl) {
    URL.revokeObjectURL(previewPhotoObjectUrl);
    previewPhotoObjectUrl = null;
  }

  if (previewPhoto) {
    previewPhoto.removeAttribute("src");
    previewPhoto.classList.remove("is-visible");
  }

  if (previewPhotoPlaceholder) {
    previewPhotoPlaceholder.classList.remove("hidden");
  }
}

// 啟動
initCardPreview();

initRegistrationStatus().then(() => {
  initAnonymousAuth();
});

console.log("Register page v1.6 registration-status loaded.");