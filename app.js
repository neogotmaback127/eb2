/**
 * Gmail Insights Standalone Dashboard
 * Data Hook: Google Apps Script JSON API
 */

const CONFIG = {
  // 여기에 GAS 배포 후 생성된 웹 앱 URL을 넣으세요.
  API_URL: 'https://script.google.com/macros/s/AKfycbwzhO4Wf7Oy0skiuxUbHrgtdw3BEOZQTYOXhDShd6NbM453fyj3npJJlZaVpgXkPQ52Cg/exec',

  // 사용자님이 제공해주신 Firebase 설정값
  FIREBASE: {
    apiKey: "AIzaSyCjPDlCQ8MXIxunpFLyzvhZUu16DW2s0bc",
    authDomain: "summary-saas.firebaseapp.com",
    projectId: "summary-saas",
    storageBucket: "summary-saas.firebasestorage.app",
    messagingSenderId: "425104835580",
    appId: "1:425104835580:web:48a74e56a7a415e9d02879",
    measurementId: "G-7MCF1SD9RW"
  }
};

const state = {
  threads: [],
  filteredThreads: [],
  currentFilter: 'all',
  loading: true,
  user: null
};

// Elements
const threadGrid = document.getElementById('thread-grid');
const connectionDot = document.getElementById('connection-dot');
const connectionText = document.getElementById('connection-text');
const totalThreadsEl = document.getElementById('total-threads');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const userNameEl = document.getElementById('user-name');

// 로그인/로그아웃 UI 업데이트
function updateUserUI(isLoggedIn) {
  if (isLoggedIn && state.user) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-block';
    if (userInfo) userInfo.style.display = 'inline-flex';
    if (userNameEl) userNameEl.innerText = state.user.displayName || state.user.email;
  } else {
    if (loginBtn) loginBtn.style.display = 'inline-block';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (userInfo) userInfo.style.display = 'none';
    if (userNameEl) userNameEl.innerText = '';
  }
}

// Firebase 초기화
let auth, db;
function initAuth() {
  const { initializeApp, getAuth, onAuthStateChanged, getFirestore } = window.FirebaseLib;
  const app = initializeApp(CONFIG.FIREBASE);
  auth = getAuth(app);
  db = getFirestore(app);

  onAuthStateChanged(auth, (user) => {
    if (user) {
      state.user = user;
      updateUserUI(true);
      checkAndFetchData();
    } else {
      state.user = null;
      updateUserUI(false);
      renderEmptyState("서비스를 이용하시려면 로그인이 필요합니다.");
    }
  });
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Firebase 라이브러리가 로드될 때까지 약간 대기
  setTimeout(initAuth, 500);
  setupEvents();
});

function setupEvents() {
  if (loginBtn) loginBtn.onclick = loginWithGoogle;
  if (logoutBtn) logoutBtn.onclick = logout;
}

async function loginWithGoogle() {
  const { GoogleAuthProvider, signInWithPopup } = window.FirebaseLib;
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error("Firebase 로그인 상세 에러:", err);
    if (err.code === 'auth/operation-not-supported-in-this-environment') {
      alert("⚠️ 현재 환경(file://)에서는 로그인이 지원되지 않습니다. 웹 서버(http://)를 통해 접속해 주세요.");
    } else if (err.code === 'auth/popup-blocked') {
      alert("⚠️ 브라우저의 팝업 차단을 해제해 주세요.");
    } else {
      alert("로그인 도중 오류가 발생했습니다: " + err.message);
    }
  }
}

async function logout() {
  const { signOut } = window.FirebaseLib;
  try {
    await signOut(auth);
  } catch (err) {
    console.error("로그아웃 실패:", err);
  }
}

async function checkAndFetchData() {
  totalThreadsEl.innerText = '로딩 중...';
  const threads = await fetchFromFirestore();
  
  state.threads = threads;
  state.filteredThreads = threads;
  state.loading = false;
  
  if (threads.length > 0) {
    setupFilters();
    updateStatus(true, "클라우드 실시간 연결됨");
    renderDashboard();
  } else {
    renderEmptyState("아직 클라우드에 데이터가 없습니다. 시계 메뉴에서 '지금 즉시 동기화'를 눌러보세요!");
  }
}

async function fetchFromFirestore() {
    const { collection, getDocs, query, where } = window.FirebaseLib;
    try {
        // 실제로는 where('ownerEmail', '==', state.user.email) 등으로 필터링해야 함
        const q = query(collection(db, "threads")); 
        const querySnapshot = await getDocs(q);
        const threads = [];
        querySnapshot.forEach((doc) => {
            let data = doc.data();
            threads.push({ id: doc.id, ...data });
        });
        
        // 날짜 파싱 헬퍼 (REST API 형식 대응)
        const parseDate = (d) => {
          if (!d) return 0;
          if (d.toDate) return d.toDate().getTime(); // Firestore SDK Timestamp
          if (typeof d === 'string') return new Date(d).getTime(); // ISO String
          return new Date(d).getTime(); // Fallback
        };

        return threads.sort((a, b) => parseDate(b.lastUpdated) - parseDate(a.lastUpdated));
    } catch (err) {
        console.error("Firestore 로드 실패:", err);
        return [];
    }
}


function updateStatus(isOk, text = "실시간 연결됨") {
  connectionDot.className = `dot ${isOk ? 'green' : 'red'}`;
  connectionText.innerText = text;
}

function setupFilters() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentFilter = tab.dataset.filter;

      if (state.currentFilter === 'all') {
        state.filteredThreads = state.threads;
      } else {
        state.filteredThreads = state.threads.filter(t => t.category === state.currentFilter);
      }
      renderDashboard();
    };
  });
}

function renderDashboard() {
  totalThreadsEl.innerText = state.filteredThreads.length;
  threadGrid.innerHTML = '';

  if (state.filteredThreads.length === 0) {
    renderEmptyState(state.currentFilter === 'all' ? "아직 요약된 메일이 없습니다." : "해당 카테고리의 메일이 없습니다.");
    return;
  }

  state.filteredThreads.forEach((thread, index) => {
    const lastMsg = thread.messages[0] || {};
    const card = document.createElement('div');
    card.className = 'thread-card';

    let categoryClass = "normal";
    let categoryIcon = "📥";
    let categoryShort = thread.category;

    if (thread.category === "자동 메일") { categoryClass = "auto"; categoryIcon = "🤖"; categoryShort = "자동"; }
    else if (thread.category === "엑셀비드 메일") { categoryClass = "excelbid"; categoryIcon = "🏢"; categoryShort = "엑셀비드"; }
    else if (thread.category === "보낸 메일") { categoryClass = "sent_mail"; categoryIcon = "📤"; categoryShort = "보냄"; }
    else if (thread.category === "받은 메일") { categoryClass = "received_mail"; categoryIcon = "📥"; categoryShort = "받음"; }

    card.innerHTML = `
      <div class="card-meta">
        <span class="badge ${thread.status.includes('종결') ? 'done' : 'new'}">${thread.status}</span>
        <span class="badge category ${categoryClass}">${categoryIcon} ${categoryShort}</span>
      </div>
      <h3>${thread.subject}</h3>
      <p>${lastMsg.summary || '내용 없음'}</p>
      <div class="footer-info">
        <span>📅 ${new Date(thread.lastUpdated?.toDate ? thread.lastUpdated.toDate() : thread.lastUpdated).toLocaleDateString()}</span>
        <button class="analyze-btn" data-index="${index}">분석</button>
      </div>
    `;

    card.onclick = () => showDetail(thread);
    card.querySelector('.analyze-btn').onclick = (e) => {
      e.stopPropagation();
      runAIAnalysis(index, thread);
    };

    threadGrid.appendChild(card);
  });
}

async function runAIAnalysis(index, thread) {
  const btn = document.querySelectorAll('.analyze-btn')[index];
  const badge = document.querySelectorAll('.badge')[index];

  btn.disabled = true;
  btn.innerText = '⌛...';

  try {
    const summaries = JSON.stringify(thread.messages.map(m => m.summary));
    const url = `${CONFIG.API_URL}?action=analyzeStatus&subject=${encodeURIComponent(thread.subject)}&summaries=${encodeURIComponent(summaries)}`;

    const response = await fetch(url);
    const result = await response.json();

    if (result.status) {
      const statusText = result.status.split(']')[0].replace('[', '');
      badge.innerText = statusText;
      badge.className = `badge ${statusText.includes('종결') ? 'done' : 'new'}`;
    }
  } catch (err) {
    console.error("AI 분석 실패:", err);
  } finally {
    btn.disabled = false;
    btn.innerText = '재분석';
  }
}

function showDetail(thread) {
  const modal = document.getElementById('modal');
  const body = document.getElementById('modal-body');
  const title = document.getElementById('modal-title');

  title.innerText = thread.subject;
  body.innerHTML = thread.messages.map(m => `
    <div class="timeline-item ${m.type.includes('받음') ? 'received' : 'sent'}">
      <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">
        ${m.person} • ${new Date(m.date?.toDate ? m.date.toDate() : m.date).toLocaleString()}
      </div>
      <div>${m.summary}</div>
    </div>
  `).join('');

  modal.style.display = 'block';
}

function renderEmptyState(msg) {
  threadGrid.innerHTML = `
    <div class="loader-container">
      <p style="text-align:center;">${msg}</p>
    </div>
  `;
}

// Modal logic
document.querySelector('.close-btn').onclick = () => {
  document.getElementById('modal').style.display = 'none';
};
window.onclick = (e) => {
  if (e.target === document.getElementById('modal')) {
    document.getElementById('modal').style.display = 'none';
  }
};
