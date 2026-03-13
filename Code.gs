/**
 * Gmail Insights SaaS Engine (v4.0 - Sheet-less Mode)
 * 스프레드시트 없이 Gmail에서 Firestore로 직접 데이터를 요약/전송합니다.
 * 필수 권한 주소: 
 * https://www.googleapis.com/auth/script.scriptapp
 * https://www.googleapis.com/auth/gmail.readonly
 * https://www.googleapis.com/auth/userinfo.email
 * https://www.googleapis.com/auth/spreadsheets
 */

// --- 🔥 핵심 설정 ---
const FIREBASE_PROJECT_ID = "summary-saas"; // 파이어베이스 프로젝트 ID
const MAX_SUMMARIES = 10; // 한 번에 요약할 새 메일 개수
const SCAN_LIMIT = 50;    // 최근 메일 중 누락된 것을 찾을 범위
// ------------------

/**
 * [트리거 전용 함수] 1시간마다 실행될 메인 엔진
 */
function RUN_SYNC_ENGINE() {
  const apiKey = getApiKey();
  if (!apiKey) return;

  // 1. 최근 메일 가져오기
  const threads = GmailApp.search('', 0, SCAN_LIMIT);
  let processedCount = 0;

  for (let i = 0; i < threads.length; i++) {
    if (processedCount >= MAX_SUMMARIES) break;

    const thread = threads[i];
    const messages = thread.getMessages();
    const lastMessage = messages[messages.length - 1];
    const messageId = lastMessage.getId();

    // 2. 이미 클라우드에 있는지 확인 (중복 방지)
    if (isAlreadySynced(messageId)) continue;

    // 3. 메일 정보 추출 및 요약
    const subject = lastMessage.getSubject();
    const body = lastMessage.getPlainBody().substring(0, 2000);
    const date = lastMessage.getDate();
    const from = lastMessage.getFrom();
    const to = lastMessage.getTo();
    const myEmail = Session.getActiveUser().getEmail();
    
    const type = (from.indexOf(myEmail) > -1) ? "보냄 📤" : "받음 📥";
    const person = (type === "보냄 📤") ? `To: ${to}` : `From: ${from}`;
    
    const summary = isImportantEmail(subject, from, body) 
      ? getGeminiSummary(apiKey, subject, body) 
      : `[간편 미리보기] ${body.substring(0, 150)}...`;

    if (summary.includes("에러 429")) break; // 할당량 초과 시 중단

    // 4. Firestore로 직접 쏘기!
    const success = syncToFirestore(messageId, date, type, person, subject, summary);
    if (success) processedCount++;

    // AI를 사용했을 때만 10초 대기 (할당량 보호)
    if (!summary.startsWith("[간편 미리보기]")) {
      Utilities.sleep(10000); 
    }
  }
  
  console.log(`동기화 완료: ${processedCount}개의 새로운 메일을 클라우드로 보냈습니다.`);
}

/**
 * Firestore에 데이터가 이미 있는지 체크
 */
function isAlreadySynced(messageId) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/threads/${messageId}`;
  const options = {
    method: 'get',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  };
  const res = UrlFetchApp.fetch(url, options);
  return res.getResponseCode() === 200; // 200이면 이미 존재함
}

/**
 * Firestore REST API로 데이터 전송
 */
function syncToFirestore(threadId, date, type, person, subject, summary) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/threads/${threadId}`;
  
  // 카테고리 분류
  const personLower = person.toLowerCase();
  let category = "일반 메일";
  if (personLower.includes("no-reply") || personLower.includes("noreply") || personLower.includes("notification")) {
    category = "자동 메일";
  }

  const payload = {
    fields: {
      threadId: { stringValue: threadId },
      subject: { stringValue: subject },
      category: { stringValue: category },
      status: { stringValue: "분석 전" },
      lastUpdated: { timestampValue: new Date(date).toISOString() },
      ownerEmail: { stringValue: Session.getActiveUser().getEmail() },
      messages: {
        arrayValue: {
          values: [{
            mapValue: {
              fields: {
                date: { timestampValue: new Date(date).toISOString() },
                type: { stringValue: type },
                person: { stringValue: person },
                summary: { stringValue: summary },
                id: { stringValue: threadId }
              }
            }
          }]
        }
      }
    }
  };

  const options = {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  };

  const res = UrlFetchApp.fetch(url, options);
  return res.getResponseCode() === 200;
}

/**
 * Gemini AI 요약 함수
 */
function getGeminiSummary(apiKey, subject, content) {
  // 이미 요약된 내용(미리보기)이면 통과
  if (content.length < 50) return content;
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const payload = { contents: [{ parts: [{ text: `이 이메일을 1~2문장으로 한국어로 요약해줘.\n제목: ${subject}\n내용: ${content}` }] }] };
  const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };

  try {
    const res = UrlFetchApp.fetch(url, options);
    if (res.getResponseCode() === 200) {
      return JSON.parse(res.getContentText()).candidates[0].content.parts[0].text.trim();
    }
    return `요약 실패 (에러 ${res.getResponseCode()})`;
  } catch (e) {
    return "요약 실패 (연결 에러)";
  }
}

/**
 * 초기 설정 및 트리거 등록
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🚀 SaaS 엔진 설정')
    .addItem('🔑 1. API 키 설정', 'SET_API_KEY')
    .addItem('⚠️ 2. 권한 에러 해결하기', 'AUTHORIZATION_FIX')
    .addSeparator()
    .addItem('🚫 3. 필터링 키워드 관리', 'MANAGE_KEYWORDS')
    .addItem('⏰ 4. 자동 실행(1시간) 시작', 'SETUP_TRIGGER')
    .addItem('🔍 5. 지금 즉시 동기화 실행', 'RUN_SYNC_ENGINE')
    .addToUi();
}

function AUTHORIZATION_FIX() {
  // 트리거 권한과 지메일 권한을 명시적으로 사용함으로써 구글이 권한 요청 팝업을 띄우게 함
  ScriptApp.getProjectTriggers();
  UrlFetchApp.fetch("https://www.google.com");
  console.log("✅ 권한 확인 완료! 이제 메뉴 버튼들을 사용하실 수 있습니다.");
}

function SET_API_KEY() {
  const res = SpreadsheetApp.getUi().prompt('Gemini API 키 입력', '키를 입력해 주세요:', SpreadsheetApp.getUi().ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() == SpreadsheetApp.getUi().Button.OK) {
    PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', res.getResponseText().trim());
    SpreadsheetApp.getUi().alert("✅ 키 저장 완료!");
  }
}

function getApiKey() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
}

function SETUP_TRIGGER() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('RUN_SYNC_ENGINE').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert("✅ 자동화 완료! 이제 시트를 닫아도 1시간마다 클라우드로 저장됩니다.");
}

/**
 * [New] 필터링 키워드 관리 UI
 */
function MANAGE_KEYWORDS() {
  const props = PropertiesService.getScriptProperties();
  let ignoreList = JSON.parse(props.getProperty('IGNORE_KEYWORDS') || '[]');
  
  if (ignoreList.length === 0) {
    // 초기 기본값 설정 (사용자 요청 반영)
    ignoreList = [
      'no-reply', 'noreply', 'notification', 'newsletter', '광고', '(광고)',
      '초대장:', '업데이트된 초대장:', 'ExelBid Reporter', 'losscode'
    ];
    props.setProperty('IGNORE_KEYWORDS', JSON.stringify(ignoreList));
  }

  const msg = `현재 제외 키워드:\n${ignoreList.join(', ')}\n\n추가할 키워드를 입력하거나, 삭제할 키워드 앞에 '-'를 붙여주세요.\n(예: '비용알림' 추가, '-광고' 삭제)`;
  const res = SpreadsheetApp.getUi().prompt('🚫 필터링 키워드 관리', msg, SpreadsheetApp.getUi().ButtonSet.OK_CANCEL);
  
  if (res.getSelectedButton() == SpreadsheetApp.getUi().Button.OK) {
    let input = res.getResponseText().trim();
    if (!input) return;

    if (input.startsWith('-')) {
      const target = input.substring(1);
      ignoreList = ignoreList.filter(k => k !== target);
    } else {
      if (!ignoreList.includes(input)) ignoreList.push(input);
    }
    
    props.setProperty('IGNORE_KEYWORDS', JSON.stringify(ignoreList));
    SpreadsheetApp.getUi().alert("✅ 키워드 설정이 업데이트되었습니다!");
  }
}

/**
 * [New] 스마트 필터링: 이 메일이 AI 요약이 필요한 '중요 메일'인지 판단
 */
function isImportantEmail(subject, from, body) {
  const fromLower = from.toLowerCase();
  const subjectLower = subject.toLowerCase();
  const props = PropertiesService.getScriptProperties();
  
  // 사용자 저장 키워드 로드
  let ignoreList = JSON.parse(props.getProperty('IGNORE_KEYWORDS') || '["no-reply", "noreply", "notification", "뉴스레터", "광고"]');
  
  // 1. 제외 리스트 검사 (사용자 정의 포함)
  for (let word of ignoreList) {
    if (fromLower.includes(word.toLowerCase()) || subjectLower.includes(word.toLowerCase())) {
      console.log(`필터링됨: ${word}`);
      return false;
    }
  }

  // 2. 포함 리스트 (이 키워드가 있으면 중요 메일로 간주)
  const priorityList = ['회의', '미팅', '안건', '공지', '확인 부탁', '급함', '긴급', '요청', '결정', '보고', '계약'];
  for (let word of priorityList) {
    if (subjectLower.includes(word)) return true;
  }

  // 3. 내용 기반 판별
  if (body.length > 300) return true; 

  return false;
}
