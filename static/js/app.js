/* ===== ExamTutor 前端逻辑 ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  jobId: null, job: null, selected: null,
  filter: 'all', chatQid: null, chatBusy: false, poller: null,
};

const STAGES = ['render', 'vision', 'consolidate', 'explain'];
const STATUS_TEXT = { correct: '已答对', wrong: '答错', unknown: '待确认', subjective: '主观题' };

// ---------- 工具 ----------
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}
function show(view) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  $(`#view-${view}`).classList.remove('hidden');
  $('#btn-new').classList.toggle('hidden', view !== 'results');
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), 2600);
}
function esc(s) { return (s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// 极简 markdown -> html（用于答疑/讲解文本）
function md(text) {
  const lines = String(text ?? '').split('\n');
  let html = '', list = null;
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (let raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { closeList(); continue; }
    if ((m = line.match(/^#{1,4}\s+(.*)/))) { closeList(); html += `<h3>${inline(m[1])}</h3>`; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { closeList(); list = 'ul'; html += '<ul>'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) { if (list !== 'ol') { closeList(); list = 'ol'; html += '<ol>'; } html += `<li>${inline(m[1])}</li>`; }
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return html;
}

// ---------- 上传 ----------
function initUpload() {
  const dz = $('#dropzone'), input = $('#file-input');
  input.addEventListener('change', () => input.files[0] && uploadFile(input.files[0]));
  ['dragenter', 'dragover'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', ev => { const f = ev.dataTransfer.files[0]; if (f) uploadFile(f); });
  $('#btn-new').addEventListener('click', () => { if (state.poller) clearInterval(state.poller); show('upload'); });
}

async function uploadFile(file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) return toast('请选择 PDF 文件');
  show('processing');
  $('#proc-file').textContent = file.name;
  renderProcessing({ stage: 'queued', progress: { label: '正在上传…', done: 0, total: 1 } });
  try {
    const fd = new FormData(); fd.append('file', file);
    const { job_id } = await api('/api/upload', { method: 'POST', body: fd });
    state.jobId = job_id;
    startPolling();
  } catch (e) { toast(e.message); show('upload'); }
}

// ---------- 轮询处理进度 ----------
function startPolling() {
  if (state.poller) clearInterval(state.poller);
  const tick = async () => {
    try {
      const job = await api(`/api/jobs/${state.jobId}`);
      state.job = job;
      if (job.status === 'processing') renderProcessing(job);
      else if (job.status === 'done') { clearInterval(state.poller); loadResults(job); }
      else if (job.status === 'error') { clearInterval(state.poller); toast('处理失败：' + (job.error || '未知错误')); show('upload'); }
    } catch (e) { /* 临时网络错误，下次重试 */ }
  };
  tick();
  state.poller = setInterval(tick, 1500);
}

function renderProcessing(job) {
  const stage = job.stage === 'queued' ? 'render' : job.stage;
  const idx = STAGES.indexOf(stage);
  $$('#stepper .step').forEach((el, i) => {
    el.classList.toggle('done', idx > i || job.stage === 'done');
    el.classList.toggle('active', idx === i && job.stage !== 'done');
  });
  const p = job.progress || {};
  $('#proc-label').textContent = p.label || '处理中…';
  const intra = p.total ? p.done / p.total : 0;
  const overall = job.stage === 'done' ? 1 : Math.min(0.98, ((idx < 0 ? 0 : idx) + intra) / STAGES.length);
  $('#progress-bar').style.width = (overall * 100).toFixed(1) + '%';
}

// ---------- 结果 ----------
function loadResults(job) {
  state.job = job;
  show('results');
  $('#exam-title').textContent = job.meta?.title || job.filename || '试卷';
  const m = job.meta || {};
  $('#exam-meta').textContent = [m.grade, m.subject, `共 ${(job.questions || []).length} 题`].filter(Boolean).join(' · ');
  renderStats(); renderNav();
  const first = (job.questions || []).find(q => q.status === 'wrong') || (job.questions || []).find(q => q.status === 'unknown') || job.questions?.[0];
  if (first) selectQuestion(first.id); else $('#detail-pane').innerHTML = '<div class="empty-detail">未识别到题目</div>';
  setChatContext(null);
}

function renderStats() {
  const s = state.job.stats || {};
  const graded = (s.correct || 0) + (s.wrong || 0);
  const acc = graded ? Math.round((s.correct / graded) * 100) : 0;
  const items = [
    ['total', '总题数', s.total || 0], ['correct', '答对', s.correct || 0],
    ['wrong', '答错', s.wrong || 0], ['unknown', '待确认', s.unknown || 0],
    ['acc', '正确率', acc + '%'],
  ];
  $('#stats-row').innerHTML = items.map(([c, l, v]) => `<div class="stat ${c}"><b>${v}</b><span>${l}</span></div>`).join('');
}

function filteredQuestions() {
  const qs = state.job.questions || [];
  return state.filter === 'all' ? qs : qs.filter(q => q.status === state.filter);
}

function renderNav() {
  const grid = $('#q-grid');
  grid.innerHTML = filteredQuestions().map(q =>
    `<div class="q-cell ${q.status}${q.id === state.selected ? ' sel' : ''}" data-qid="${q.id}" title="第${esc(q.number)}题 · ${STATUS_TEXT[q.status] || ''}">${esc(q.number)}</div>`
  ).join('') || '<div style="color:var(--ink-3);font-size:13px;grid-column:1/-1;text-align:center;padding:14px 0">该分类暂无题目</div>';
  $$('.q-cell', grid).forEach(c => c.addEventListener('click', () => selectQuestion(c.dataset.qid)));
}

function initFilters() {
  $$('#filter-tabs button').forEach(b => b.addEventListener('click', () => {
    $$('#filter-tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); state.filter = b.dataset.f; renderNav();
  }));
}

function findQ(qid) { return (state.job.questions || []).find(q => q.id === qid); }

function selectQuestion(qid) {
  state.selected = qid;
  renderNav();
  renderDetail(findQ(qid));
  setChatContext(qid);
}

function optionRows(q) {
  if (!q.options) return '';
  return '<div class="opts">' + Object.entries(q.options).map(([k, v]) => {
    let cls = '', tags = [];
    if (q.correct_answer && k === q.correct_answer) { cls = 'correct'; tags.push('正确答案'); }
    if (q.student_answer && k === q.student_answer) { if (k !== q.correct_answer) cls = 'chosen-wrong'; tags.push('你的答案'); }
    return `<div class="opt ${cls}"><span class="key">${esc(k)}</span><span>${esc(v)}</span>${tags.length ? `<span class="tag">${tags.join(' · ')}</span>` : ''}</div>`;
  }).join('') + '</div>';
}

function answerControl(q) {
  if (q.options) {
    const keys = Object.keys(q.options);
    const seg = keys.map(k => `<button class="${q.student_answer === k ? 'on' : ''}" data-ov="${k}">${k}</button>`).join('');
    return `<div class="answer-control"><span class="label">我的答案：</span><div class="seg">${seg}</div>
      <button class="btn btn-mini" data-ov="">清除</button></div>`;
  }
  // 非选择题：展示参考答案 + 自评
  const ref = q.correct_answer ? `<div class="label">参考答案：<b>${esc(q.correct_answer)}</b></div>` : '<div class="label">该题为主观题，无标准答案</div>';
  return `<div class="answer-control" style="flex-direction:column;align-items:stretch;gap:10px">
      ${ref}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="label">自评：</span>
        <button class="btn btn-mini" data-st="correct">我答对了</button>
        <button class="btn btn-mini" data-st="wrong">我答错了</button>
        <button class="btn btn-mini" data-st="unknown">待确认</button>
      </div></div>`;
}

function explainBlock(q) {
  const e = q.explanation;
  if (q.status === 'correct') return `<div class="ex-card"><div class="body">🎉 这道题你答对了，继续保持！如有疑问可在右侧提问。</div></div>`;
  if (q.status === 'subjective') return `<div class="ex-card"><div class="body">✍️ 主观题不自动判分。可在右侧让 AI 家教帮你点评或给范例。</div></div>`;
  if (!e) return `<div class="ex-card"><div class="ex-loading"><span class="typing"><i></i><i></i><i></i></span>暂无讲解，<a href="#" id="gen-explain">点此生成</a></div></div>`;
  const card = (title, body, cls = '') => body ? `<div class="ex-card ${cls}"><h4>${title}</h4><div class="body">${md(body)}</div></div>` : '';
  return `<div class="explain">
    ${card('🎯 答案分析', e.answer_analysis)}
    ${card('⚠️ 错因 / 易错点', e.why_wrong)}
    ${card('💡 解题技巧', e.tips, 'tips')}
    ${card('📚 例句', e.examples, 'examples')}
  </div>`;
}

function renderDetail(q) {
  if (!q) return;
  const pane = $('#detail-pane');
  pane.innerHTML = `
    <div class="d-crumb">
      <span>第 ${esc(q.number)} 题</span>·<span>${esc(q.section || '')}</span>·<span>${esc(q.type || '')}</span>
      <span class="status-badge ${q.status}" style="margin-left:auto">${STATUS_TEXT[q.status] || q.status}</span>
    </div>
    ${q.passage ? `<div class="d-passage">${esc(q.passage)}</div>` : ''}
    <div class="d-stem">${esc(q.stem)}</div>
    ${optionRows(q)}
    ${answerControl(q)}
    ${q.knowledge_point ? `<div style="margin-bottom:14px"><span class="kp-chip">🏷 ${esc(q.knowledge_point)}</span></div>` : ''}
    <h3 style="font-size:15px;margin-bottom:4px">讲解</h3>
    ${explainBlock(q)}
    <div class="d-actions">
      <button class="btn btn-mini" id="ask-this">💬 就这道题提问</button>
    </div>`;

  $$('[data-ov]', pane).forEach(b => b.addEventListener('click', () => overrideAnswer(q.id, { student_answer: b.dataset.ov })));
  $$('[data-st]', pane).forEach(b => b.addEventListener('click', () => overrideAnswer(q.id, { status: b.dataset.st })));
  const gen = $('#gen-explain', pane);
  if (gen) gen.addEventListener('click', e => { e.preventDefault(); overrideAnswer(q.id, { student_answer: q.student_answer, status: q.status }); });
  $('#ask-this', pane).addEventListener('click', () => { setChatContext(q.id); $('#chat-text').focus(); });
}

async function overrideAnswer(qid, payload) {
  try {
    const pane = $('#detail-pane');
    const loading = $('.explain', pane) || $('#detail-pane');
    toast('更新中…');
    const { question, stats } = await api(`/api/jobs/${state.jobId}/questions/${qid}/override`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const q = findQ(qid); Object.assign(q, question);
    state.job.stats = stats;
    renderStats(); renderNav(); renderDetail(q);
    toast('已更新');
  } catch (e) { toast(e.message); }
}

// ---------- 答疑 ----------
function setChatContext(qid) {
  state.chatQid = qid;
  const q = qid ? findQ(qid) : null;
  $('#chat-context').textContent = q ? `正在讨论：第${q.number}题` : '整卷答疑';
  renderQuickPrompts(q);
  loadChat();
}

function renderQuickPrompts(q) {
  const box = $('#chat-quick');
  const prompts = q
    ? ['讲讲这道题考点', '我为什么会错', '再出一道类似的题', '这个知识点详细说说']
    : ['总结我的薄弱知识点', '这张卷子我该怎么订正', '初三英语怎么提分'];
  box.innerHTML = prompts.map(p => `<button>${p}</button>`).join('');
  $$('button', box).forEach(b => b.addEventListener('click', () => { $('#chat-text').value = b.textContent; sendChat(); }));
}

async function loadChat() {
  const key = state.chatQid || '';
  try {
    const { messages } = await api(`/api/jobs/${state.jobId}/chat${key ? `?qid=${key}` : ''}`);
    renderChat(messages);
  } catch { renderChat([]); }
}

function renderChat(messages) {
  const box = $('#chat-msgs');
  if (!messages.length) {
    box.innerHTML = `<div class="chat-empty">💬 ${state.chatQid ? '针对这道题，问我任何问题吧' : '关于这张卷子或任何英语知识点，问我吧'}</div>`;
    return;
  }
  box.innerHTML = messages.map(m => `<div class="bubble ${m.role === 'user' ? 'user' : 'ai'}">${m.role === 'user' ? esc(m.content) : md(m.content)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

function initChat() {
  $('#chat-clear').addEventListener('click', () => setChatContext(null));
  $('#chat-form').addEventListener('submit', e => { e.preventDefault(); sendChat(); });
  const ta = $('#chat-text');
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; });
}

async function sendChat() {
  if (state.chatBusy) return;
  const ta = $('#chat-text'); const text = ta.value.trim();
  if (!text) return;
  ta.value = ''; ta.style.height = 'auto';
  state.chatBusy = true; $('#chat-send').disabled = true;
  const box = $('#chat-msgs');
  if ($('.chat-empty', box)) box.innerHTML = '';
  box.insertAdjacentHTML('beforeend', `<div class="bubble user">${esc(text)}</div>`);
  box.insertAdjacentHTML('beforeend', `<div class="bubble ai" id="pending"><span class="typing"><i></i><i></i><i></i></span></div>`);
  box.scrollTop = box.scrollHeight;
  try {
    const { answer } = await api(`/api/jobs/${state.jobId}/ask`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: text, qid: state.chatQid }),
    });
    $('#pending').outerHTML = `<div class="bubble ai">${md(answer)}</div>`;
  } catch (e) {
    $('#pending').outerHTML = `<div class="bubble ai">⚠️ ${esc(e.message)}</div>`;
  } finally {
    state.chatBusy = false; $('#chat-send').disabled = false;
    box.scrollTop = box.scrollHeight;
  }
}

// ---------- 原卷 ----------
function initPaper() {
  $('#btn-paper').addEventListener('click', () => {
    const n = state.job.page_count || 0;
    $('#paper-pages').innerHTML = Array.from({ length: n }, (_, i) =>
      `<img loading="lazy" src="/api/jobs/${state.jobId}/page/${i + 1}" alt="第${i + 1}页" />`).join('');
    $('#paper-modal').classList.remove('hidden');
  });
  $('#paper-close').addEventListener('click', () => $('#paper-modal').classList.add('hidden'));
  $('.modal-backdrop', $('#paper-modal')).addEventListener('click', () => $('#paper-modal').classList.add('hidden'));
}

// ---------- 启动 ----------
async function resumeJob(jid) {
  try {
    const job = await api(`/api/jobs/${jid}`);
    state.job = job;
    if (job.status === 'done') loadResults(job);
    else if (job.status === 'processing') { show('processing'); startPolling(); }
    else { toast('该作业处理失败'); show('upload'); }
  } catch { toast('找不到该作业'); show('upload'); }
}

initUpload(); initFilters(); initChat(); initPaper();
const _deepJob = new URLSearchParams(location.search).get('job');
if (_deepJob) { state.jobId = _deepJob; resumeJob(_deepJob); } else show('upload');
