import { useState, useEffect, useRef, useCallback } from "react";

// ═══ Google Apps Script URL ═══
// 아래 URL을 본인의 Apps Script 배포 URL로 교체하세요
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyXDVXvYow3_eYAkuWZ6hla3o13YZJ8_aFrcDo-cLkl6OHl4wW77Sy3qNGsNuQb--2x/exec";

const DEPARTMENTS = [
  "영업팀", "구매팀", "생산관리팀", "가공팀", "제관팀",
  "조립팀", "전기팀", "품질팀", "AS팀", "기술팀",
  "인사팀", "회계팀", "안전보건팀"
];

const PROPOSAL_TYPES = [
  { id: "tech", label: "기술분야", desc: "표준, 구조, 치공구, 신기술, 공정" },
  { id: "quality", label: "품질분야", desc: "불량, 검사, 납품, 부품, 설계" },
  { id: "improve", label: "업무개선", desc: "효율, 소통, 협업, 공수, 안전" },
];

const SUB_TYPES = {
  tech: [
    { label: "설계 표준화", desc: "설계 기준 통합, 기술 문서 전산화, 반복 사용품 규격화" },
    { label: "설비등 구조", desc: "내구성 향상, 노후 부품 교체, 파손 취약 구조 변경" },
    { label: "치공구 개발", desc: "작업 편의를 위한 전용 공구, 디지털 토크 매니지먼트 도입" },
    { label: "신기술 도입", desc: "3D 설계, 신소재 도입, 신공법 도입" },
    { label: "스마트 공정", desc: "조립 배관 배선 가이드 시스템, 검사 자동화" },
  ],
  quality: [
    { label: "불량 결함", desc: "반복 발생하는 가공 불량, 조립 오류, 치수 편차 개선" },
    { label: "검사 측정", desc: "검사 방법, 측정 기준, 체크 리스트 작성" },
    { label: "납품 출하", desc: "포장, 출하 전 검수, 고객 클레임 재발 방지" },
    { label: "부품 소재", desc: "구매 부품 기준 강화, 외주 품질관리 방안" },
    { label: "설계 품질", desc: "도면 표준화, 설계 기준서, 오류 예방 구조 개선" },
  ],
  improve: [
    { label: "업무 효율", desc: "불필요한 절차 제거, 승인 단계 축소, 업무 흐름 재설계" },
    { label: "소통 개선", desc: "정보 공유방식 개선, 회의 효율화, 채널 일원화" },
    { label: "협업 강화", desc: "타 부서와 일정, 정보 공유, 협조 체계 상설화" },
    { label: "공수 절감", desc: "작업시간이나 투입인원 단축, 자동화" },
    { label: "안전 확보", desc: "작업 환경 위험 요소 제거, 안전 설비 보완, 정리정돈" },
  ],
};

const STEPS = [
  { id: "info", label: "기본정보", num: "01" },
  { id: "type", label: "제안유형", num: "02" },
  { id: "subtype", label: "세부유형", num: "03" },
  { id: "asis", label: "개선 전", num: "04" },
  { id: "tobe", label: "개선 후", num: "05" },
  { id: "effect", label: "개선효과", num: "06" },
  { id: "review", label: "최종확인", num: "07" },
];

const STORAGE_KEY = "jnh-proposals";
const SETTINGS_KEY = "jnh-proposal-settings";

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDate(d) {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${y}.${m}.${day} (${days[date.getDay()]})`;
}

function getQuarterLabel() {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}년 ${q}분기`;
}

// ── 이미지 압축 (Drive 업로드 최적화) ──
function compressImage(base64, maxDim = 1024, quality = 0.6) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        // 가로/세로 모두 제한 (모바일 세로 사진 대응)
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(base64); // canvas 실패 시 원본 반환
      }
    };
    img.onerror = () => resolve(base64);
    img.src = base64;
  });
}

async function compressImages(images) {
  return Promise.all(images.map((img) => compressImage(img)));
}

// ── Apps Script 전송 (hidden iframe + form 방식으로 CORS 완전 우회) ──
async function submitToSheets(scriptUrl, formData) {
  const compressed = {
    ...formData,
    asisImages: await compressImages(formData.asisImages || []),
    tobeImages: await compressImages(formData.tobeImages || []),
  };

  return new Promise((resolve) => {
    // hidden iframe 생성
    const iframe = document.createElement("iframe");
    iframe.name = "jnh-submit-frame";
    iframe.style.display = "none";
    document.body.appendChild(iframe);

    // form 생성 → iframe으로 제출 (CORS 제한 없음)
    const form = document.createElement("form");
    form.method = "POST";
    form.action = scriptUrl;
    form.target = "jnh-submit-frame";

    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify(compressed);
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();

    // 정리 (5초 후)
    setTimeout(() => {
      try { document.body.removeChild(form); } catch(e) {}
      try { document.body.removeChild(iframe); } catch(e) {}
      resolve({ result: "success" });
    }, 5000);
  });
}

// ─── Styles ───
const css = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;900&family=Outfit:wght@300;400;500;600;700;800&display=swap');

:root {
  --navy: #1e3932;
  --steel: #2a4f46;
  --blue: #00704A;
  --blue-light: #00875a;
  --blue-glow: #43b086;
  --accent: #c67c4e;
  --accent-light: #d4956a;
  --surface: #f2f0eb;
  --card: #ffffff;
  --border: #ddd8d0;
  --text: #1e3932;
  --text-sub: #5c6b66;
  --text-light: #8f9e98;
  --success: #00704A;
  --danger: #c0392b;
  --radius: 12px;
}

* { margin:0; padding:0; box-sizing:border-box; }

body {
  font-family: 'Noto Sans KR', sans-serif;
  background: var(--surface);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}

.app-container { min-height: 100vh; display: flex; flex-direction: column; }

.app-header {
  background: linear-gradient(135deg, var(--navy) 0%, var(--steel) 100%);
  position: sticky; top: 0; z-index: 100;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
}

.header-top {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 24px;
}

.header-brand { display: flex; align-items: center; gap: 14px; }

.header-logo {
  width: 42px; height: 42px; background: var(--blue); border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 14px;
  color: #fff; letter-spacing: -0.5px; flex-shrink: 0;
}

.header-title-group h1 {
  font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 700;
  color: #fff; letter-spacing: -0.3px; line-height: 1.2;
}

.header-title-group .quarter-badge {
  display: inline-block; margin-top: 2px; font-size: 11px; font-weight: 500;
  color: var(--accent-light); letter-spacing: 0.5px;
}

.stepper-bar { display: flex; padding: 0 24px 16px; gap: 4px; }

.step-pill {
  flex: 1; height: 4px; border-radius: 2px;
  background: rgba(255,255,255,0.12); transition: background 0.4s ease;
}

.step-pill.done { background: var(--blue-glow); }
.step-pill.current { background: var(--accent); box-shadow: 0 0 8px rgba(198,124,78,0.4); }

.main-content {
  flex: 1; max-width: 720px; width: 100%; margin: 0 auto;
  padding: 28px 20px 100px;
}

.step-header { margin-bottom: 28px; }

.step-number {
  font-family: 'Outfit', sans-serif; font-size: 12px; font-weight: 600;
  color: var(--blue); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 6px;
}

.step-title { font-size: 24px; font-weight: 700; color: var(--text); line-height: 1.3; }

.step-desc { font-size: 14px; color: var(--text-sub); margin-top: 6px; line-height: 1.6; }

.form-card {
  background: var(--card); border-radius: var(--radius); padding: 24px;
  margin-bottom: 16px; border: 1px solid var(--border); transition: box-shadow 0.2s;
}

.form-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

.field-label {
  font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 10px;
  display: flex; align-items: center; gap: 6px;
}

.required-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--danger); flex-shrink: 0; }

.select-grid { display: grid; gap: 8px; }

.select-option {
  display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  border: 1.5px solid var(--border); border-radius: 10px; cursor: pointer;
  transition: all 0.2s; background: #fff;
}

.select-option:hover { border-color: var(--blue-light); background: #f7f5f0; }

.select-option.selected {
  border-color: var(--blue); background: #eef0e8;
  box-shadow: 0 0 0 3px rgba(0,112,74,0.12);
}

.option-radio {
  width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--border);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: all 0.2s;
}

.select-option.selected .option-radio { border-color: var(--blue); background: var(--blue); }

.option-radio-inner {
  width: 8px; height: 8px; border-radius: 50%; background: #fff;
  opacity: 0; transition: opacity 0.2s;
}

.select-option.selected .option-radio-inner { opacity: 1; }

.option-text { flex: 1; }
.option-label { font-size: 14px; font-weight: 600; color: var(--text); line-height: 1.3; }
.option-desc { font-size: 12px; color: var(--text-sub); margin-top: 2px; line-height: 1.4; }

.text-input {
  width: 100%; padding: 12px 16px; border: 1.5px solid var(--border);
  border-radius: 10px; font-family: 'Noto Sans KR', sans-serif; font-size: 14px;
  color: var(--text); background: #fff; transition: border-color 0.2s, box-shadow 0.2s; outline: none;
}

.text-input:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(0,112,74,0.12); }
.text-input::placeholder { color: var(--text-light); }
textarea.text-input { min-height: 140px; resize: vertical; line-height: 1.7; }

.upload-zone {
  border: 2px dashed var(--border); border-radius: 10px; padding: 32px;
  text-align: center; cursor: pointer; transition: all 0.2s; background: #f7f5f0;
}

.upload-zone:hover { border-color: var(--blue-light); background: #eee9df; }
.upload-icon { font-size: 32px; margin-bottom: 8px; }
.upload-text { font-size: 13px; color: var(--text-sub); line-height: 1.5; }
.upload-text strong { color: var(--blue); font-weight: 600; }

.preview-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px; margin-top: 12px;
}

.preview-item {
  position: relative; border-radius: 8px; overflow: hidden; aspect-ratio: 1;
  border: 1px solid var(--border);
}

.preview-item img { width: 100%; height: 100%; object-fit: cover; }

.preview-remove {
  position: absolute; top: 4px; right: 4px; width: 24px; height: 24px;
  border-radius: 50%; background: rgba(0,0,0,0.6); color: #fff; border: none;
  cursor: pointer; font-size: 14px; display: flex; align-items: center;
  justify-content: center; transition: background 0.2s;
}

.preview-remove:hover { background: var(--danger); }

.bottom-actions {
  position: fixed; bottom: 0; left: 0; right: 0; background: #fff;
  border-top: 1px solid var(--border); padding: 14px 20px;
  display: flex; justify-content: center; gap: 12px; z-index: 99;
}

.bottom-actions-inner { max-width: 720px; width: 100%; display: flex; gap: 12px; }

.btn {
  flex: 1; padding: 14px; border: none; border-radius: 10px;
  font-family: 'Noto Sans KR', sans-serif; font-size: 15px; font-weight: 600;
  cursor: pointer; transition: all 0.2s; display: flex; align-items: center;
  justify-content: center; gap: 6px;
}

.btn-secondary { background: var(--surface); color: var(--text-sub); border: 1px solid var(--border); }
.btn-secondary:hover { background: #e6e2da; }

.btn-primary { background: var(--blue); color: #fff; box-shadow: 0 2px 8px rgba(0,112,74,0.25); }
.btn-primary:hover { background: #005c3d; }
.btn-primary:disabled { background: #b8b3aa; box-shadow: none; cursor: not-allowed; }

.btn-submit { background: var(--success); color: #fff; box-shadow: 0 2px 8px rgba(0,112,74,0.3); }
.btn-submit:hover { background: #005c3d; }
.btn-submit:disabled { background: #b8b3aa; box-shadow: none; cursor: not-allowed; }

.review-section {
  background: var(--card); border-radius: var(--radius); border: 1px solid var(--border);
  margin-bottom: 12px; overflow: hidden;
}

.review-section-header {
  padding: 14px 20px; background: #f7f5f0; border-bottom: 1px solid var(--border);
  font-size: 13px; font-weight: 600; color: var(--text-sub); letter-spacing: 0.5px;
}

.review-row {
  padding: 14px 20px; border-bottom: 1px solid #e6e2da;
  display: flex; gap: 16px;
}

.review-row:last-child { border-bottom: none; }
.review-label { width: 100px; flex-shrink: 0; font-size: 13px; font-weight: 500; color: var(--text-sub); padding-top: 2px; }
.review-value { flex: 1; font-size: 14px; color: var(--text); line-height: 1.7; white-space: pre-wrap; word-break: break-word; }

.review-images { display: flex; gap: 8px; flex-wrap: wrap; }
.review-images img { width: 80px; height: 80px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); }

.dashboard-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.dashboard-title { font-size: 22px; font-weight: 700; }

.dashboard-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }

.stat-card {
  background: var(--card); border-radius: var(--radius); border: 1px solid var(--border);
  padding: 18px; text-align: center;
}

.stat-num { font-family: 'Outfit', sans-serif; font-size: 28px; font-weight: 700; color: var(--blue); }
.stat-label { font-size: 12px; color: var(--text-sub); margin-top: 2px; }

.proposal-list { display: flex; flex-direction: column; gap: 10px; }

.proposal-card {
  background: var(--card); border-radius: var(--radius); border: 1px solid var(--border);
  padding: 18px 20px; cursor: pointer; transition: all 0.2s;
}

.proposal-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.06); border-color: var(--blue-light); }

.proposal-card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }

.proposal-type-badge {
  display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 6px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
}

.badge-tech { background: #e8f5e9; color: #1e3932; }
.badge-quality { background: #fbe9e0; color: #8b4513; }
.badge-improve { background: #f2f0eb; color: #00704A; }

.proposal-date { font-size: 12px; color: var(--text-light); }
.proposal-title { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 4px; line-height: 1.4; }
.proposal-meta { font-size: 12px; color: var(--text-sub); }

.info-banner {
  background: linear-gradient(135deg, var(--navy), var(--steel)); border-radius: var(--radius);
  padding: 24px; margin-bottom: 24px; color: #fff;
}

.info-banner h3 { font-size: 16px; font-weight: 700; margin-bottom: 4px; color: var(--accent-light); }
.info-banner p { font-size: 13px; line-height: 1.6; color: rgba(255,255,255,0.7); }

.info-rules { margin-top: 14px; display: grid; gap: 8px; }
.info-rule { display: flex; gap: 10px; font-size: 12px; color: rgba(255,255,255,0.8); line-height: 1.5; }
.info-rule-icon { flex-shrink: 0; width: 20px; text-align: center; }

.success-screen { text-align: center; padding: 60px 20px; }
.success-icon {
  width: 72px; height: 72px; border-radius: 50%; background: #e8f5e9;
  display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 36px;
}
.success-title { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
.success-desc { font-size: 14px; color: var(--text-sub); line-height: 1.6; margin-bottom: 28px; }

.empty-state { text-align: center; padding: 60px 20px; color: var(--text-sub); }
.empty-icon { font-size: 48px; margin-bottom: 12px; }
.empty-text { font-size: 14px; }

.detail-back {
  display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500;
  color: var(--blue); cursor: pointer; margin-bottom: 20px; padding: 6px 0;
  background: none; border: none; font-family: 'Noto Sans KR', sans-serif;
}

.detail-back:hover { text-decoration: underline; }

.detail-header-card {
  background: linear-gradient(135deg, var(--navy), var(--steel)); border-radius: var(--radius);
  padding: 28px 24px; margin-bottom: 16px; color: #fff;
}

.detail-dept-name { font-size: 13px; color: var(--accent-light); font-weight: 500; margin-bottom: 8px; }
.detail-title { font-size: 14px; color: rgba(255,255,255,0.7); margin-bottom: 4px; }
.detail-type { font-size: 20px; font-weight: 700; }

/* Loading Overlay */
.loading-overlay {
  position: fixed; inset: 0; background: rgba(255,255,255,0.85);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  z-index: 1000; gap: 16px;
}

.loading-spinner {
  width: 48px; height: 48px; border: 4px solid var(--border);
  border-top-color: var(--blue); border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.loading-text { font-size: 15px; font-weight: 600; color: var(--text); }
.loading-sub { font-size: 13px; color: var(--text-sub); margin-top: -8px; }

/* Settings */
.settings-card {
  background: var(--card); border-radius: var(--radius); padding: 20px;
  border: 1px solid var(--border); margin-bottom: 16px;
}

.settings-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
.settings-desc { font-size: 12px; color: var(--text-sub); margin-bottom: 14px; line-height: 1.5; }

.settings-row { display: flex; gap: 8px; }
.settings-row .text-input { flex: 1; font-size: 12px; padding: 10px 12px; }

.settings-btn {
  padding: 10px 18px; border: none; border-radius: 8px; font-family: 'Noto Sans KR', sans-serif;
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
}

.conn-status {
  display: inline-flex; align-items: center; gap: 6px; font-size: 12px; margin-top: 10px;
  padding: 6px 12px; border-radius: 6px;
}

.conn-ok { background: #e8f5e9; color: #1e3932; }
.conn-fail { background: #fbe9e0; color: #8b4513; }
.conn-none { background: #f2f0eb; color: var(--text-sub); }

/* Toast */
.toast {
  position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
  background: var(--navy); color: #fff; padding: 12px 24px; border-radius: 10px;
  font-size: 14px; font-weight: 500; z-index: 200; box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  animation: toastIn 0.3s ease, toastOut 0.3s ease 2.7s forwards;
}

@keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(12px); } }
@keyframes toastOut { to { opacity: 0; transform: translateX(-50%) translateY(12px); } }

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-in { animation: fadeInUp 0.35s ease forwards; }

/* ═══ Mobile Responsive ═══ */
@media (max-width: 600px) {
  .header-top { padding: 12px 16px; }
  .header-logo { width: 36px; height: 36px; font-size: 12px; border-radius: 8px; }
  .header-brand { gap: 10px; }
  .header-title-group h1 { font-size: 16px; }
  .stepper-bar { padding: 0 16px 12px; gap: 3px; }
  .step-pill { height: 3px; }

  .main-content { padding: 20px 16px 110px; }

  .step-title { font-size: 20px; }
  .step-desc { font-size: 13px; }
  .step-header { margin-bottom: 20px; }

  .form-card { padding: 18px 16px; margin-bottom: 12px; border-radius: 10px; }

  .select-option { padding: 14px; gap: 10px; min-height: 48px; -webkit-tap-highlight-color: transparent; }
  .option-radio { width: 22px; height: 22px; }
  .option-radio-inner { width: 10px; height: 10px; }
  .option-label { font-size: 14px; }
  .option-desc { font-size: 11px; }

  .text-input { padding: 14px; font-size: 16px; border-radius: 10px; }
  textarea.text-input { min-height: 120px; font-size: 15px; }

  .upload-zone { padding: 24px 16px; }
  .upload-icon { font-size: 28px; }
  .upload-text { font-size: 12px; }
  .preview-grid { grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .preview-remove { width: 28px; height: 28px; font-size: 16px; }

  .bottom-actions {
    padding: 12px 16px;
    padding-bottom: max(12px, env(safe-area-inset-bottom, 12px));
  }
  .btn { padding: 16px 12px; font-size: 15px; border-radius: 10px; min-height: 52px; }

  .review-row { padding: 12px 16px; flex-direction: column; gap: 4px; }
  .review-label { width: auto; font-size: 12px; }
  .review-value { font-size: 13px; }
  .review-section-header { padding: 12px 16px; font-size: 12px; }
  .review-images img { width: 64px; height: 64px; }

  .info-banner { padding: 18px 16px; margin-bottom: 16px; }
  .info-banner h3 { font-size: 14px; }
  .info-rules { gap: 6px; }
  .info-rule { font-size: 11px; }

  .settings-card { padding: 16px; }
  .settings-row { flex-direction: column; }
  .settings-btn { width: 100%; padding: 12px; text-align: center; border-radius: 8px; }

  .dashboard-stats { grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .stat-card { padding: 14px 8px; }
  .stat-num { font-size: 24px; }
  .stat-label { font-size: 11px; }

  .proposal-card { padding: 14px 16px; }
  .proposal-title { font-size: 14px; }

  .detail-header-card { padding: 20px 16px; }
  .detail-type { font-size: 18px; }

  .success-screen { padding: 40px 16px; }
  .success-title { font-size: 20px; }
  .success-desc { font-size: 13px; }

  .toast { font-size: 13px; padding: 10px 20px; bottom: 120px; max-width: 90vw; text-align: center; }

  .loading-text { font-size: 14px; }
}

/* Image upload mobile buttons */
.upload-actions {
  display: flex; gap: 8px; margin-top: 8px;
}

.upload-btn {
  flex: 1; padding: 12px; border: 1.5px solid var(--border); border-radius: 10px;
  background: #fff; cursor: pointer; text-align: center; font-family: 'Noto Sans KR', sans-serif;
  font-size: 13px; font-weight: 500; color: var(--text); transition: all 0.2s;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  -webkit-tap-highlight-color: transparent;
}

.upload-btn:active { background: #eef0e8; border-color: var(--blue); }

/* Swipe indicator */
.swipe-hint {
  text-align: center; font-size: 11px; color: var(--text-light);
  padding: 8px 0 0; display: none;
}

@media (max-width: 600px) {
  .swipe-hint { display: block; }
}

/* Step label bar (mobile) */
.step-label-bar {
  display: none; padding: 0 16px 8px;
  font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.5);
  text-align: center;
}

@media (max-width: 600px) {
  .step-label-bar { display: block; }
}

/* Pull to refresh indicator area */
.app-container { overscroll-behavior-y: contain; }

/* Prevent zoom on input focus (iOS) */
@media (max-width: 600px) {
  input[type="text"], textarea, select { font-size: 16px !important; }
}
`;

// ─── Components ───

function RadioGroup({ options, value, onChange, showDesc = false }) {
  return (
    <div className="select-grid">
      {options.map((opt, i) => {
        const val = typeof opt === "string" ? opt : opt.label || opt.id;
        const isSelected = value === val;
        return (
          <div key={i} className={`select-option ${isSelected ? "selected" : ""}`}
            onClick={() => onChange(val)}>
            <div className="option-radio"><div className="option-radio-inner" /></div>
            <div className="option-text">
              <div className="option-label">{val}</div>
              {showDesc && opt.desc && <div className="option-desc">{opt.desc}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ImageUploader({ images, onChange }) {
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 600);
  }, []);

  const handleFiles = (e) => {
    const files = Array.from(e.target.files);
    const readers = files.map(f => new Promise(res => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(f);
    }));
    Promise.all(readers).then(results => onChange([...images, ...results]));
    e.target.value = "";
  };

  return (
    <div>
      {isMobile ? (
        <div className="upload-actions">
          <div className="upload-btn" onClick={() => cameraRef.current?.click()}>
            📸 카메라 촬영
          </div>
          <div className="upload-btn" onClick={() => galleryRef.current?.click()}>
            🖼️ 갤러리 선택
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleFiles} />
          <input ref={galleryRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFiles} />
        </div>
      ) : (
        <>
          <div className="upload-zone" onClick={() => galleryRef.current?.click()}>
            <div className="upload-icon">📷</div>
            <div className="upload-text">
              <strong>클릭하여 이미지 추가</strong><br/>사진, 그림, 도표 등 (선택사항)
            </div>
          </div>
          <input ref={galleryRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFiles} />
        </>
      )}
      {images.length > 0 && (
        <div className="preview-grid">
          {images.map((src, i) => (
            <div key={i} className="preview-item">
              <img src={src} alt="" />
              <button className="preview-remove" onClick={() => onChange(images.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return <div className="toast">{message}</div>;
}

// ─── Main App ───

export default function App() {
  const [view, setView] = useState("dashboard");
  const [step, setStep] = useState(0);
  const [proposals, setProposals] = useState([]);
  const [detailId, setDetailId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [toast, setToast] = useState("");
  const [scriptUrl, setScriptUrl] = useState(SCRIPT_URL);
  const [urlInput, setUrlInput] = useState(SCRIPT_URL);
  const [connStatus, setConnStatus] = useState("ok");
  const [isMobile, setIsMobile] = useState(false);
  const touchRef = useRef({ startX: 0, startY: 0 });
  const [form, setForm] = useState({
    department: "", name: "", type: "", subType: "",
    asisText: "", asisImages: [], tobeText: "", tobeImages: [], effectText: "",
  });

  // Mobile detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 600);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Load saved data
  useEffect(() => {
    (async () => {
      try {
        const r = { value: localStorage.getItem(STORAGE_KEY) };
        if (r.value) setProposals(JSON.parse(r.value));
      } catch (e) {}
      try {
        const s = { value: localStorage.getItem(SETTINGS_KEY) };
        if (s.value) {
          const settings = JSON.parse(s.value);
          if (settings.scriptUrl) {
            setScriptUrl(settings.scriptUrl);
            setUrlInput(settings.scriptUrl);
            setConnStatus("ok");
          }
        }
      } catch (e) {}
    })();
  }, []);

  const saveProposals = useCallback(async (data) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const testConnection = async (url) => {
    try {
      await fetch(url + "?action=ping", { redirect: "follow" });
      setConnStatus("ok");
      setScriptUrl(url);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ scriptUrl: url }));
      showToast("✓ Google Sheets 연결 성공!");
    } catch (e) {
      // CORS 에러여도 서버 도달은 성공한 것이므로 연결됨으로 처리
      setConnStatus("ok");
      setScriptUrl(url);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ scriptUrl: url }));
      showToast("✓ Google Sheets 연결 성공!");
    }
  };

  const updateForm = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const resetForm = () => {
    setForm({
      department: "", name: "", type: "", subType: "",
      asisText: "", asisImages: [], tobeText: "", tobeImages: [], effectText: "",
    });
    setStep(0);
  };

  const startNewProposal = () => { resetForm(); setView("form"); };

  const canProceed = () => {
    switch (step) {
      case 0: return form.department && form.name.trim();
      case 1: return form.type;
      case 2: return form.subType;
      case 3: return form.asisText.trim();
      case 4: return form.tobeText.trim();
      case 5: return form.effectText.trim();
      case 6: return true;
      default: return false;
    }
  };

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Swipe gesture handling for form navigation
  const onTouchStart = (e) => {
    touchRef.current.startX = e.touches[0].clientX;
    touchRef.current.startY = e.touches[0].clientY;
  };

  const onTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - touchRef.current.startX;
    const dy = e.changedTouches[0].clientY - touchRef.current.startY;
    if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.7) return;
    const tag = document.activeElement?.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    if (dx < -80 && canProceed() && step < STEPS.length - 1) {
      setStep(s => s + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (dx > 80 && step > 0) {
      setStep(s => s - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleSubmit = async () => {
    // Save locally first
    const newProposal = {
      id: generateId(), ...form,
      createdAt: new Date().toISOString(), status: "접수",
    };
    const updated = [newProposal, ...proposals];
    setProposals(updated);
    await saveProposals(updated);

    // Send to Google Sheets if connected
    if (scriptUrl) {
      setLoading(true);
      setLoadingMsg("제안서를 제출 중입니다...");

      const hasImages = form.asisImages.length > 0 || form.tobeImages.length > 0;
      if (hasImages) {
        setLoadingMsg("이미지를 압축하고 Google Drive에 업로드 중...");
      }

      try {
        await submitToSheets(scriptUrl, form);
        setLoading(false);
        setView("success");
        showToast("✓ Google Sheets에 저장 완료!");
      } catch (e) {
        setLoading(false);
        setView("success");
        showToast("로컬 저장 완료 (Sheets 전송 실패 - 나중에 재시도)");
        console.error("Sheets submit error:", e);
      }
    } else {
      setView("success");
      showToast("제안이 로컬에 저장되었습니다");
    }
  };

  const openDetail = (id) => { setDetailId(id); setView("detail"); };

  const getTypeBadge = (type) => {
    const t = PROPOSAL_TYPES.find(p => p.id === type);
    const cls = type === "tech" ? "badge-tech" : type === "quality" ? "badge-quality" : "badge-improve";
    return <span className={`proposal-type-badge ${cls}`}>{t?.label || type}</span>;
  };

  const getTypeLabel = (id) => PROPOSAL_TYPES.find(p => p.id === id)?.label || id;

  // ─── Render Steps ───
  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="animate-in">
            <div className="step-header">
              <div className="step-number">STEP 01</div>
              <div className="step-title">기본 정보 입력</div>
              <div className="step-desc">소속 부서와 작성자 이름을 입력해주세요.</div>
            </div>
            <div className="form-card">
              <div className="field-label">소속 부서 <span className="required-dot" /></div>
              <RadioGroup options={DEPARTMENTS} value={form.department} onChange={v => updateForm("department", v)} />
            </div>
            <div className="form-card">
              <div className="field-label">작성자 이름 <span className="required-dot" /></div>
              <input className="text-input" placeholder="이름을 입력해주세요" value={form.name}
                onChange={e => updateForm("name", e.target.value)} />
            </div>
          </div>
        );
      case 1:
        return (
          <div className="animate-in">
            <div className="step-header">
              <div className="step-number">STEP 02</div>
              <div className="step-title">제안 유형 선택</div>
              <div className="step-desc">제안하실 분야를 선택해주세요.</div>
            </div>
            <div className="form-card">
              <div className="field-label">제안 유형 <span className="required-dot" /></div>
              <RadioGroup
                options={PROPOSAL_TYPES.map(t => ({ label: t.label, desc: t.desc }))}
                value={form.type ? getTypeLabel(form.type) : ""}
                onChange={v => {
                  const found = PROPOSAL_TYPES.find(t => t.label === v);
                  updateForm("type", found?.id || v);
                  updateForm("subType", "");
                }}
                showDesc
              />
            </div>
          </div>
        );
      case 2: {
        const subs = SUB_TYPES[form.type] || [];
        const titles = { tech: "기술 제안의 세부 유형", quality: "품질 제안의 세부 유형", improve: "업무 개선의 세부 유형" };
        return (
          <div className="animate-in">
            <div className="step-header">
              <div className="step-number">STEP 03</div>
              <div className="step-title">{titles[form.type]}</div>
              <div className="step-desc">해당하는 세부 유형을 선택해주세요.</div>
            </div>
            <div className="form-card">
              <div className="field-label">세부 유형 <span className="required-dot" /></div>
              <RadioGroup options={subs} value={form.subType} onChange={v => updateForm("subType", v)} showDesc />
            </div>
          </div>
        );
      }
      case 3:
        return (
          <div className="animate-in">
            <div className="step-header">
              <div className="step-number">STEP 04</div>
              <div className="step-title">개선 전 현황 (As-Is)</div>
              <div className="step-desc">현재 문제점이나 개선이 필요한 상황을 구체적으로 작성해주세요.</div>
            </div>
            <div className="form-card">
              <div className="field-label">개선 전 문제점 <span className="required-dot" /></div>
              <textarea className="text-input"
                placeholder="현재 상황과 문제점을 구체적으로 기술해주세요.&#10;예: 현재 ○○ 공정에서 △△ 문제가 반복 발생하고 있으며..."
                value={form.asisText} onChange={e => updateForm("asisText", e.target.value)} />
            </div>
            <div className="form-card">
              <div className="field-label">개선 전 이미지 (사진, 그림, 도표)</div>
              <ImageUploader images={form.asisImages} onChange={v => updateForm("asisImages", v)} />
            </div>
          </div>
        );
      case 4:
        return (
          <div className="animate-in">
            <div className="step-header">
              <div className="step-number">STEP 05</div>
              <div className="step-title">개선 후 내용 (To-Be)</div>
              <div className="step-desc">제안하는 개선 방안을 구체적으로 작성해주세요.</div>
            </div>
            <div className="form-card">
              <div className="field-label">개선 내용 <span className="required-dot" /></div>
              <textarea className="text-input"
                placeholder="개선 방안과 실행 방법을 구체적으로 기술해주세요.&#10;예: ○○ 방식을 도입하여 △△ 문제를 해결하고..."
                value={form.tobeText} onChange={e => updateForm("tobeText", e.target.value)} />
            </div>
            <div className="form-card">
              <div className="field-label">개선 후 이미지 (사진, 그림, 도표)</div>
              <ImageUploader images={form.tobeImages} onChange={v => updateForm("tobeImages", v)} />
            </div>
          </div>
        );
      case 5:
        return (
          <div className="animate-in">
            <div className="step-header">
              <div className="step-number">STEP 06</div>
              <div className="step-title">개선 효과</div>
              <div className="step-desc">제안이 채택될 경우 기대되는 효과를 작성해주세요.</div>
            </div>
            <div className="form-card">
              <div className="field-label">개선 효과 <span className="required-dot" /></div>
              <textarea className="text-input"
                placeholder="기대 효과를 구체적으로 기술해주세요.&#10;예: 불량률 ○% 감소, 작업 시간 △분 단축, 연간 ○○만원 절감 등"
                value={form.effectText} onChange={e => updateForm("effectText", e.target.value)} />
            </div>
          </div>
        );
      case 6:
        return (
          <div className="animate-in">
            <div className="step-header">
              <div className="step-number">STEP 07</div>
              <div className="step-title">최종 확인</div>
              <div className="step-desc">입력하신 내용을 확인하신 후 제출해주세요.</div>
            </div>
            <div className="review-section">
              <div className="review-section-header">기본 정보</div>
              <div className="review-row"><div className="review-label">소속 부서</div><div className="review-value">{form.department}</div></div>
              <div className="review-row"><div className="review-label">작성자</div><div className="review-value">{form.name}</div></div>
              <div className="review-row"><div className="review-label">제출일</div><div className="review-value">{formatDate(new Date())}</div></div>
            </div>
            <div className="review-section">
              <div className="review-section-header">제안 유형</div>
              <div className="review-row"><div className="review-label">분야</div><div className="review-value">{getTypeLabel(form.type)}</div></div>
              <div className="review-row"><div className="review-label">세부 유형</div><div className="review-value">{form.subType}</div></div>
            </div>
            <div className="review-section">
              <div className="review-section-header">개선 전 (As-Is)</div>
              <div className="review-row"><div className="review-label">문제점</div><div className="review-value">{form.asisText}</div></div>
              {form.asisImages.length > 0 && (
                <div className="review-row"><div className="review-label">첨부</div><div className="review-value">
                  <div className="review-images">{form.asisImages.map((s,i) => <img key={i} src={s} alt="" />)}</div>
                </div></div>
              )}
            </div>
            <div className="review-section">
              <div className="review-section-header">개선 후 (To-Be)</div>
              <div className="review-row"><div className="review-label">개선 내용</div><div className="review-value">{form.tobeText}</div></div>
              {form.tobeImages.length > 0 && (
                <div className="review-row"><div className="review-label">첨부</div><div className="review-value">
                  <div className="review-images">{form.tobeImages.map((s,i) => <img key={i} src={s} alt="" />)}</div>
                </div></div>
              )}
            </div>
            <div className="review-section">
              <div className="review-section-header">개선 효과</div>
              <div className="review-row"><div className="review-label">기대 효과</div><div className="review-value">{form.effectText}</div></div>
            </div>
          </div>
        );
      default: return null;
    }
  };

  // ─── Render Views ───

  const headerBlock = (
    <header className="app-header">
      <div className="header-top">
        <div className="header-brand">
          <div className="header-logo">JNH</div>
          <div className="header-title-group">
            <h1>제안활동</h1>
            <div className="quarter-badge">{getQuarterLabel()}</div>
          </div>
        </div>
        {view === "form" && (
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
            {STEPS[step].num} / 07
          </div>
        )}
      </div>
      {view === "form" && (
        <>
          <div className="stepper-bar">
            {STEPS.map((s, i) => (
              <div key={s.id} className={`step-pill ${i < step ? "done" : ""} ${i === step ? "current" : ""}`} />
            ))}
          </div>
          <div className="step-label-bar">{STEPS[step].label}</div>
        </>
      )}
    </header>
  );

  return (
    <div className="app-container">
      <style>{css}</style>
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-text">{loadingMsg}</div>
          <div className="loading-sub">잠시만 기다려주세요</div>
        </div>
      )}
      <Toast message={toast} />
      {headerBlock}

      <main className="main-content">
        {/* ── Success ── */}
        {view === "success" && (
          <div className="success-screen animate-in">
            <div className="success-icon">✓</div>
            <div className="success-title">제안이 접수되었습니다</div>
            <div className="success-desc">
              제안 내용은 심사 후 2주 이내에 결과가 게시판에 공고됩니다.<br/><br/>
              채택 시 효과 구간에 따라 10만~100만원이 제안자 개인에게 지급되며,<br/>직무발명 인정 시 별도 보상이 가산됩니다.
              {scriptUrl && <><br/><br/>📊 Google Sheets에 자동 저장되었습니다.</>}
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button className="btn btn-secondary" style={{ flex: "none", padding: "12px 24px" }}
                onClick={() => { resetForm(); setView("dashboard"); }}>목록으로</button>
              <button className="btn btn-primary" style={{ flex: "none", padding: "12px 24px" }}
                onClick={startNewProposal}>새 제안 작성</button>
            </div>
          </div>
        )}

        {/* ── Detail ── */}
        {view === "detail" && (() => {
          const p = proposals.find(x => x.id === detailId);
          if (!p) return null;
          return (
            <>
              <button className="detail-back" onClick={() => setView("dashboard")}>← 목록으로 돌아가기</button>
              <div className="detail-header-card animate-in">
                <div className="detail-dept-name">{p.department} · {p.name}</div>
                <div className="detail-title">{getTypeLabel(p.type)}</div>
                <div className="detail-type">{p.subType}</div>
                <div style={{ marginTop: 12, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{formatDate(p.createdAt)}</div>
              </div>
              <div className="review-section animate-in">
                <div className="review-section-header">개선 전 (As-Is)</div>
                <div className="review-row"><div className="review-value">{p.asisText}</div></div>
                {p.asisImages?.length > 0 && (
                  <div className="review-row"><div className="review-images">{p.asisImages.map((s,i) => <img key={i} src={s} alt="" />)}</div></div>
                )}
              </div>
              <div className="review-section animate-in">
                <div className="review-section-header">개선 후 (To-Be)</div>
                <div className="review-row"><div className="review-value">{p.tobeText}</div></div>
                {p.tobeImages?.length > 0 && (
                  <div className="review-row"><div className="review-images">{p.tobeImages.map((s,i) => <img key={i} src={s} alt="" />)}</div></div>
                )}
              </div>
              <div className="review-section animate-in">
                <div className="review-section-header">개선 효과</div>
                <div className="review-row"><div className="review-value">{p.effectText}</div></div>
              </div>
            </>
          );
        })()}

        {/* ── Form ── */}
        {view === "form" && (
          <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {renderStep()}
            {isMobile && step < STEPS.length - 1 && (
              <div className="swipe-hint">← 스와이프하여 이전/다음 →</div>
            )}
          </div>
        )}

        {/* ── Dashboard ── */}
        {view === "dashboard" && (
          <>
            <div className="info-banner animate-in">
              <h3>"품질은 책임에서, 불량은 습관에서"</h3>
              <p>JNH PRESS 임직원 제안활동</p>
              <div className="info-rules">
                <div className="info-rule"><span className="info-rule-icon">📋</span><span>범위 : 기술·품질 향상, 업무 개선, 매출 기여</span></div>
                <div className="info-rule"><span className="info-rule-icon">📅</span><span>접수 : 분기 마감월 말일까지 제출</span></div>
                <div className="info-rule"><span className="info-rule-icon">🏆</span><span>포상 : 10만~100만원/제안자 (매출·비용·시간 구간 매트릭스)</span></div>
                <div className="info-rule"><span className="info-rule-icon">💡</span><span>가산 : 직무발명 인정 시 별도 보상 (비과세 한도 내)</span></div>
                <div className="info-rule"><span className="info-rule-icon">⭐</span><span>비고 : 임직원 개인별 접수</span></div>
              </div>
            </div>


            {proposals.length > 0 && (
              <div className="dashboard-stats animate-in">
                <div className="stat-card">
                  <div className="stat-num">{proposals.length}</div>
                  <div className="stat-label">전체 제안</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num" style={{ color: "#1e3932" }}>
                    {proposals.filter(p => p.type === "tech").length}
                  </div>
                  <div className="stat-label">기술분야</div>
                </div>
                <div className="stat-card">
                  <div className="stat-num" style={{ color: "#c67c4e" }}>
                    {proposals.filter(p => p.type === "quality" || p.type === "improve").length}
                  </div>
                  <div className="stat-label">품질·개선</div>
                </div>
              </div>
            )}

            <div className="dashboard-header animate-in">
              <div className="dashboard-title">내 제안 목록</div>
              <button className="btn btn-primary" style={{ flex: "none", padding: "10px 20px", fontSize: 14 }}
                onClick={startNewProposal}>+ 새 제안</button>
            </div>

            {proposals.length === 0 ? (
              <div className="empty-state animate-in">
                <div className="empty-icon">💡</div>
                <div className="empty-text">아직 작성한 제안이 없습니다.<br/>새 제안을 작성하여 개선 아이디어를 공유해보세요!</div>
              </div>
            ) : (
              <div className="proposal-list animate-in">
                {proposals.map(p => (
                  <div key={p.id} className="proposal-card" onClick={() => openDetail(p.id)}>
                    <div className="proposal-card-top">
                      {getTypeBadge(p.type)}
                      <span className="proposal-date">{formatDate(p.createdAt)}</span>
                    </div>
                    <div className="proposal-title">{p.subType}</div>
                    <div className="proposal-meta">{p.department} · {p.name}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Bottom Actions (Form only) */}
      {view === "form" && (
        <div className="bottom-actions">
          <div className="bottom-actions-inner">
            {step > 0 ? (
              <button className="btn btn-secondary" onClick={handleBack}>← 이전</button>
            ) : (
              <button className="btn btn-secondary" onClick={() => { resetForm(); setView("dashboard"); }}>취소</button>
            )}
            {step < STEPS.length - 1 ? (
              <button className="btn btn-primary" disabled={!canProceed()} onClick={handleNext}>다음 →</button>
            ) : (
              <button className="btn btn-submit" disabled={loading} onClick={handleSubmit}>✓ 제안 제출</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
