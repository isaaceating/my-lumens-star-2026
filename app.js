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
  query,
  where,
  onSnapshot,
  serverTimestamp,
  runTransaction
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

// 正式上線前應為 false
const VOTING_TEST_MODE = false;

const VOTING_START = new Date("2026-06-20T00:00:00+08:00");
const VOTING_END = new Date("2026-07-28T23:59:59+08:00");

const REGISTRATION_AUTO_CLOSE_TIME = new Date("2026-06-01T00:00:00+08:00");

// DOM
const loginButton = document.getElementById("loginButton");
const logoutButton = document.getElementById("logoutButton");
const userStatus = document.getElementById("userStatus");
const contestantsGrid = document.getElementById("contestantsGrid");
const votingStatusText = document.getElementById("votingStatusText");
const registrationLinks = document.querySelectorAll(".registration-link");

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

onAuthStateChanged(auth, async (user) => {
  // 報名頁的 Anonymous Auth 可能會被瀏覽器保留。
  // 首頁投票只接受 Google 帳號，所以匿名帳號在首頁視為未登入。
  if (user && user.isAnonymous) {
    currentUser = null;
    userStatus.textContent = "尚未登入，投票請使用 Google 帳號登入";
    loginButton.classList.remove("hidden");
    logoutButton.classList.add("hidden");

    try {
      await signOut(auth);
    } catch (error) {
      console.warn("Anonymous sign out failed:", error);
    }

    return;
  }

  currentUser = user;

  if (user && user.email) {
    userStatus.textContent = `已登入：${user.email}`;
    loginButton.classList.add("hidden");
    logoutButton.classList.remove("hidden");

    console.log("Google user logged in:", user.email);
    console.log("User UID:", user.uid);
  } else {
    userStatus.textContent = "尚未登入，投票請使用 Google 帳號登入";
    loginButton.classList.remove("hidden");
    logoutButton.classList.add("hidden");

    console.log("User logged out");
  }
});

// -----------------------------
// Registration Status
// -----------------------------
function getAutoRegistrationStatus() {
  const now = new Date();

  return {
    isOpen: now < REGISTRATION_AUTO_CLOSE_TIME,
    source: "auto"
  };
}

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

    return getAutoRegistrationStatus();
  } catch (error) {
    console.error("Load registration status failed:", error);
    return getAutoRegistrationStatus();
  }
}

function renderRegistrationLinks(registrationStatus) {
  registrationLinks.forEach((link) => {
    if (!link.dataset.originalText) {
      link.dataset.originalText = link.textContent;
    }

    if (registrationStatus.isOpen) {
      link.textContent = link.dataset.originalText || "我要報名";
      link.setAttribute("href", "register.html");
      link.classList.remove("registration-closed-link");
      link.setAttribute("aria-disabled", "false");
      return;
    }

    link.textContent = "報名已截止";
    link.removeAttribute("href");
    link.classList.add("registration-closed-link");
    link.setAttribute("aria-disabled", "true");
  });
}

async function updateRegistrationLinks() {
  const registrationStatus = await getRegistrationStatus();
  renderRegistrationLinks(registrationStatus);
}

function listenToRegistrationStatus() {
  const settingsRef = doc(db, "settings", "registration");

  onSnapshot(
    settingsRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();

        renderRegistrationLinks({
          isOpen: data.isOpen === true,
          source: "admin"
        });

        return;
      }

      renderRegistrationLinks(getAutoRegistrationStatus());
    },
    (error) => {
      console.error("Listen registration status failed:", error);
      updateRegistrationLinks();
    }
  );
}

// -----------------------------
// Voting Status
// -----------------------------
function getVotingStatus() {
  const now = new Date();

  if (VOTING_TEST_MODE) {
    return {
      status: "open",
      text: "測試模式開放中",
      buttonText: "人氣應援",
      canVote: true
    };
  }

  if (now < VOTING_START) {
    return {
      status: "not-started",
      text: "尚未開放投票",
      buttonText: "尚未開放",
      canVote: false
    };
  }

  if (now > VOTING_END) {
    return {
      status: "ended",
      text: "投票已結束",
      buttonText: "投票已結束",
      canVote: false
    };
  }

  return {
    status: "open",
    text: "投票進行中",
    buttonText: "人氣應援",
    canVote: true
  };
}

function updateVotingStatusUI() {
  const votingStatus = getVotingStatus();

  if (votingStatusText) {
    votingStatusText.textContent = votingStatus.text;
  }
}

// -----------------------------
// 讀取已公開選手卡片
// -----------------------------
function listenToPublishedContestants() {
  contestantsGrid.innerHTML = `
    <p class="message">參賽選手載入中...</p>
  `;

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

        if (orderA !== orderB) return orderA - orderB;

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
  const votingStatus = getVotingStatus();

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
        <article class="contestant-card compact-contestant-card">
          <div class="contestant-photo-wrap">
            <img
              class="contestant-photo"
              src="${escapeHtml(contestant.photoUrl)}"
              alt="${escapeHtml(contestant.name)}"
              loading="lazy"
            />
          </div>

          <div class="contestant-body contestant-body-centered">
            <div class="contestant-meta-row">
              <span class="contestant-number">No. ${number}</span>
              <span class="contestant-department">
                ${escapeHtml(contestant.department || "Lumens")}
              </span>
            </div>

            <h3 class="contestant-name">${escapeHtml(contestant.name)}</h3>
            <p class="contestant-stage">${stageName}</p>

            <div class="song-block compact-song-block">
              <div class="song-label">演唱歌曲</div>
              <p class="contestant-performance">
                ${escapeHtml(contestant.performanceItem)}
              </p>
            </div>

            <div class="vote-row vote-row-centered compact-vote-row">
              <span class="vote-count">人氣票數：${contestant.voteCount || 0}</span>
              <button
                class="vote-button compact-vote-button"
                data-id="${contestant.id}"
                ${votingStatus.canVote ? "" : "disabled"}
              >
                ${votingStatus.buttonText}
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".vote-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const votingStatus = getVotingStatus();

      if (!votingStatus.canVote) {
        alert(votingStatus.text);
        return;
      }

      const contestantId = button.dataset.id;
      await handleVote(contestantId, button);
    });
  });
}

// -----------------------------
// 人氣應援投票
// -----------------------------
async function handleVote(contestantId, button) {
  try {
    if (!currentUser || !currentUser.email || currentUser.isAnonymous) {
      alert("請先使用 Google 帳號登入後再投票。");
      return;
    }

    const now = new Date();

    if (!VOTING_TEST_MODE && (now < VOTING_START || now > VOTING_END)) {
      alert("目前不在人氣應援投票期間。投票期間為 2026/6/20 - 2026/7/28。");
      return;
    }

    const voteDate = getTaiwanDateString(new Date());
    const voteId = `${currentUser.uid}_${voteDate}`;

    const contestantRef = doc(db, "contestants", contestantId);
    const voteRef = doc(db, "votes", voteId);

    button.disabled = true;
    button.textContent = "投票中...";

    await runTransaction(db, async (transaction) => {
      const voteSnap = await transaction.get(voteRef);

      if (voteSnap.exists()) {
        throw new Error("ALREADY_VOTED_TODAY");
      }

      const contestantSnap = await transaction.get(contestantRef);

      if (!contestantSnap.exists()) {
        throw new Error("CONTESTANT_NOT_FOUND");
      }

      const contestantData = contestantSnap.data();

      if (contestantData.publishStatus !== true) {
        throw new Error("CONTESTANT_NOT_PUBLISHED");
      }

      const currentVoteCount = contestantData.voteCount || 0;

      transaction.set(voteRef, {
        uid: currentUser.uid,
        email: currentUser.email,
        voteDate,
        contestantId,
        contestantName: contestantData.name || "",
        createdAt: serverTimestamp()
      });

      transaction.update(contestantRef, {
        voteCount: currentVoteCount + 1
      });
    });

    alert("投票成功！感謝你的每日人氣應援。");
  } catch (error) {
    console.error("Vote failed:", error);

    if (error.message === "ALREADY_VOTED_TODAY") {
      alert("你今天已經投過票囉，明天再來應援！");
    } else if (error.message === "CONTESTANT_NOT_FOUND") {
      alert("找不到此參賽選手，請重新整理後再試。");
    } else if (error.message === "CONTESTANT_NOT_PUBLISHED") {
      alert("此選手尚未公開，無法投票。");
    } else {
      alert(`投票失敗：${error.code || ""} ${error.message || ""}`);
    }
  } finally {
    button.disabled = false;
    button.textContent = "人氣應援";
  }
}

// -----------------------------
// Utils
// -----------------------------
function getTaiwanDateString(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(date);
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
listenToRegistrationStatus();
updateVotingStatusUI();
listenToPublishedContestants();

console.log("Homepage app v1.6 realtime-registration-status loaded.");