(() => {
  'use strict';

  const ROOT = '__root';
  const CFG_KEY = 'board.cfg';
  const DRAFT_KEY = 'board.draft';
  // proto = 화면 프로토타입만 있고 실제 기능은 아직 없는 상태
  const STATUS = { todo: '예정', proto: '프로토타입', doing: '진행 중', done: '완료' };
  const NEXT = { todo: 'proto', proto: 'doing', doing: 'done', done: 'todo' };
  const EDIT_FIELDS = ['title', 'desc', 'demo', 'note', 'start', 'end', 'flow'];
  const MAX_DEPTH = 4; // 1 보드 · 2 섹션 · 3 항목 · 4 하위 항목
  const LOG_LIMIT = 150;

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const uid = () => 'n' + Math.random().toString(36).slice(2, 10);
  const when = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // ── 데이터 ────────────────────────────────────────────────
  function normNode(n, depth) {
    const o = {
      id: n.id || uid(),
      title: n.title || '',
      desc: n.desc || '',
      status: STATUS[n.status] ? n.status : 'todo',
      demo: !!n.demo,
      note: n.note || '',
    };
    if (depth === 1) { o.start = n.start || ''; o.end = n.end || ''; o.flow = !!n.flow; }
    if (n.updatedAt) { o.updatedAt = n.updatedAt; o.updatedBy = n.updatedBy || ''; }
    o.children = (n.children || []).map((c) => normNode(c, depth + 1));
    return o;
  }
  function normalize(d) {
    return {
      version: 1,
      title: d.title || '개발 보드',
      boards: (d.boards || []).map((b) => normNode(b, 1)),
      log: Array.isArray(d.log) ? d.log : [],
    };
  }
  function index(data) {
    const map = new Map();
    const walk = (node, parent, depth, path) => {
      map.set(node.id, { node, parent, depth, path });
      const next = depth >= 1 ? [...path, node.title] : path;
      node.children.forEach((c) => walk(c, node, depth + 1, next));
    };
    walk({ id: ROOT, title: '', children: data.boards }, null, 0, []);
    return map;
  }
  function leaves(n, out = []) {
    if (!n.children.length) out.push(n); else n.children.forEach((c) => leaves(c, out));
    return out;
  }
  function tally(nodes) {
    const l = nodes.flatMap((n) => leaves(n));
    const count = (s) => l.filter((x) => x.status === s).length;
    return { total: l.length, done: count('done'), doing: count('doing'), proto: count('proto') };
  }
  function statusOf(n) {
    if (!n.children.length) return n.status;
    const t = tally(n.children);
    if (t.done === t.total) return 'done';
    if (t.done || t.doing) return 'doing';
    return t.proto ? 'proto' : 'todo';
  }
  const label = (e) => (e.depth === 1 ? `보드 「${e.node.title}」` : [...e.path.slice(1), e.node.title].join(' › '));

  // base → local 사이에 바뀐 것들
  function diff(a, b) {
    const A = index(a), B = index(b), out = [];
    for (const [id, e] of B) {
      if (id === ROOT) continue;
      const o = A.get(id);
      if (!o) { if (A.has(e.parent.id)) out.push({ id, text: `추가: ${label(e)}` }); continue; }
      if (o.parent.id !== e.parent.id) out.push({ id, text: `이동: ${label(e)}` });
      if (o.node.status !== e.node.status && !e.node.children.length) out.push({ id, text: `${STATUS[e.node.status]}: ${label(e)}` });
      if (EDIT_FIELDS.some((f) => o.node[f] !== e.node[f])) out.push({ id, text: `수정: ${label(e)}` });
    }
    for (const [id, o] of A) {
      if (id !== ROOT && !B.has(id) && B.has(o.parent.id)) out.push({ id, text: `삭제: ${label(o)}` });
    }
    for (const [id, e] of B) {
      const o = A.get(id);
      if (!o) continue;
      const stay = (n, other) => n.children.filter((c) => other.get(c.id)?.parent.id === id).map((c) => c.id).join();
      if (stay(o.node, B) !== stay(e.node, A)) out.push({ id, text: `순서 변경: ${id === ROOT ? '보드' : label(e)}` });
    }
    return out;
  }

  // 내가 base에서 local로 바꾼 내용을, 그 사이 다른 사람이 저장한 remote 위에 다시 얹는다.
  function rebase(base, local, remote) {
    const m = clone(remote);
    const A = index(base), L = index(local);
    let M = index(m);
    const detach = (id) => {
      const e = M.get(id);
      if (!e || !e.parent) return null;
      const i = e.parent.children.indexOf(e.node);
      if (i >= 0) e.parent.children.splice(i, 1);
      return e.node;
    };

    for (const [id] of A) if (id !== ROOT && !L.has(id) && M.has(id)) { detach(id); M = index(m); }

    for (const [id, e] of L) {
      const o = A.get(id), t = M.get(id);
      if (id === ROOT || !o || !t) continue;
      let touched = false;
      for (const f of [...EDIT_FIELDS, 'status']) {
        if (o.node[f] !== e.node[f]) { t.node[f] = e.node[f]; touched = true; }
      }
      if (touched && e.node.updatedAt) { t.node.updatedAt = e.node.updatedAt; t.node.updatedBy = e.node.updatedBy; }
    }

    const ids = (n) => n.children.map((c) => c.id).join();
    const plan = [];
    for (const [pid, e] of L) {
      const o = A.get(pid), t = M.get(pid);
      if (!o || !t || ids(e.node) === ids(o.node)) continue;
      const want = [];
      for (const c of e.node.children) {
        if (M.has(c.id)) {
          const stayedLocally = A.get(c.id)?.parent.id === pid;
          const movedRemotely = M.get(c.id).parent.id !== pid;
          if (!(stayedLocally && movedRemotely)) want.push({ id: c.id });
        } else if (!A.has(c.id)) {
          want.push({ add: clone(c) });
        }
      }
      const mine = new Set(e.node.children.map((c) => c.id));
      const rest = t.node.children.filter((c) => {
        if (mine.has(c.id)) return false;
        if (!A.has(c.id)) return true; // 다른 사람이 새로 추가
        const was = A.get(c.id).parent.id;
        return was !== pid && L.get(c.id)?.parent.id === was; // 다른 사람이 이쪽으로 옮김
      });
      plan.push({ parent: t.node, want, rest });
    }
    for (const p of plan) for (const w of p.want) {
      if (w.id) { w.node = detach(w.id); continue; }
      // 새로 만든 항목 아래로 기존 항목을 옮겨 넣은 경우, 원래 자리의 것은 뺀다.
      for (const id of index({ boards: w.add.children }).keys()) if (id !== ROOT) detach(id);
    }
    for (const p of plan) p.parent.children = [...p.want.map((w) => w.node || w.add).filter(Boolean), ...p.rest];
    return m;
  }

  // ── 저장소 (Supabase) ─────────────────────────────────────
  // 보드는 board_versions 표에 "판"으로 쌓인다. 가장 큰 id가 현재 보드이고,
  // 저장은 최신 판을 parent_id로 지정한 새 줄을 추가하는 것이다. 누구나 읽고 추가할 수 있다.
  function readStore(key) { try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; } }
  function writeStore(key, val) { try { val == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(val)); } catch { /* 저장소를 못 쓰는 환경 */ } }

  const conf = window.BOARD_CONFIG || {};
  const online = !!(conf.supabaseUrl && conf.supabaseKey);
  const cfg = { name: (readStore(CFG_KEY) || {}).name || '' };
  writeStore(CFG_KEY, cfg.name ? { name: cfg.name } : null); // 예전 버전이 넣어 둔 토큰 등은 지운다

  function api(method, query, body) {
    return fetch(`${conf.supabaseUrl}/rest/v1/board_versions${query}`, {
      method,
      cache: 'no-store',
      headers: { apikey: conf.supabaseKey, 'Content-Type': 'application/json', ...(method === 'POST' ? { Prefer: 'return=representation' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  async function rows(query) {
    const r = await api('GET', query);
    if (!r.ok) throw new Error(`보드를 불러오지 못했습니다 (${r.status}).`);
    return r.json();
  }
  async function latest() {
    const [row] = await rows('?select=id,data&order=id.desc&limit=1');
    return row ? { version: row.id, data: normalize(row.data) } : null;
  }

  async function fetchRemote() {
    if (online) {
      try {
        const cur = await latest();
        if (cur) return { ...cur, source: 'online' };
      } catch { /* 아래 저장본으로 */ }
    }
    const r = await fetch('data.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('보드를 불러오지 못했습니다.');
    return { data: normalize(await r.json()), version: null, source: 'static' };
  }

  // ── 상태 ──────────────────────────────────────────────────
  const state = { base: null, local: null, source: '', boardId: null, selId: null, panel: null, filter: 'all', saving: false, loadedAt: 0 };

  const board = () => state.local.boards.find((b) => b.id === state.boardId) || state.local.boards[0];
  const changes = () => diff(state.base, state.local);
  const persist = () => writeStore(DRAFT_KEY, changes().length ? { base: state.base, local: state.local } : null);

  function adopt(remote) {
    // 원격 최신본을 기준으로 삼고, 저장 안 한 내 변경은 그 위에 다시 얹는다.
    const base = state.base, local = state.local;
    state.base = remote;
    state.local = base && diff(base, local).length ? normalize(rebase(base, local, remote)) : clone(remote);
    const ix = index(state.local);
    if (state.selId && !ix.has(state.selId)) { state.selId = null; if (state.panel === 'node') state.panel = null; }
    persist();
  }

  function touch(node) { node.updatedAt = new Date().toISOString(); node.updatedBy = cfg.name || ''; }
  function commit(full = true) { persist(); full ? render() : (renderTop(), renderCanvas()); }

  // ── 그리기 ────────────────────────────────────────────────
  function render() { renderTop(); renderCanvas(); renderPanel(); }

  function renderTop() {
    const d = state.local;
    document.title = d.title;
    $('#title').textContent = d.title;

    const n = changes().length;
    const save = $('#btnSave');
    save.disabled = !n || state.saving;
    save.innerHTML = state.saving ? '저장 중…' : `저장${n ? `<span class="count${n !== shownCount ? ' bump' : ''}">${n}</span>` : ''}`;
    shownCount = n;

    const b = board();
    renderTabs(d.boards, b);

    const t = tally(b.children);
    const pct = (v) => (t.total ? (v / t.total) * 100 : 0);
    // 막대와 필터는 요소를 그대로 두고 값만 바꿔야 전환 효과가 이어진다.
    $('#progress .done').style.width = `${pct(t.done)}%`;
    $('#progress .doing').style.width = `${pct(t.doing)}%`;
    $('#progress .proto').style.width = `${pct(t.proto)}%`;
    $('#progressText').innerHTML = `완료 <b>${t.done}</b> · 진행 중 <b>${t.doing}</b> · 프로토타입 <b>${t.proto}</b> · 전체 <b>${t.total}</b>`;
    for (const c of document.querySelectorAll('#filters .chip')) c.setAttribute('aria-pressed', c.dataset.filter === state.filter);
  }

  // 탭은 보드 목록이 바뀔 때만 새로 만들고, 평소에는 글자와 선택 상태만 바꾼다.
  // 매번 innerHTML로 갈아엎으면 누른 버튼이 사라져 포커스·호버가 끊긴다.
  function renderTabs(boards, b) {
    const nav = $('#tabs');
    const ids = boards.map((x) => x.id).join('\n');
    if (nav.dataset.ids !== ids) {
      nav.dataset.ids = ids;
      nav.innerHTML = boards.map((x) => `<button class="tab" role="tab" data-board="${esc(x.id)}"><span class="tab-t"></span><small></small></button>`).join('')
        + `<button class="tab-edit" data-board-edit>보드 설정</button>`;
    }
    const tabs = nav.querySelectorAll('.tab');
    boards.forEach((x, i) => {
      const el = tabs[i], t = tally(x.children), on = x.id === b.id;
      el.querySelector('.tab-t').textContent = x.title || '(이름 없음)';
      el.querySelector('small').textContent = `${t.done}/${t.total}`;
      el.setAttribute('aria-selected', on);
      el.tabIndex = on ? 0 : -1;
    });
    $('[data-board-edit]', nav).setAttribute('aria-pressed', state.panel === 'node' && state.selId === b.id);
  }

  let shownCount = 0;
  function hit(n, g) {
    const f = state.filter;
    if (f === 'all') return true;
    if (f === 'demo') return n.demo || g.demo || n.children.some((c) => c.demo);
    return leaves(n).some((x) => x.status === f);
  }
  // 필터만 바뀔 때는 다시 그리지 않고 흐리게 처리만 바꾼다.
  function applyFilter() {
    const ix = index(state.local);
    for (const el of document.querySelectorAll('#canvas .card, #canvas .head.solo')) {
      const e = ix.get(el.dataset.id);
      if (e) el.classList.toggle('dim', !hit(e.node, e.depth === 3 ? e.parent : e.node));
    }
  }

  function renderCanvas() {
    const b = board();
    const selCls = (n) => (n.id === state.selId && state.panel === 'node' ? ' sel' : '');
    const dot = (n) => {
      const s = statusOf(n), auto = n.children.length > 0;
      return `<button class="st st-${s}" data-st="${esc(n.id)}"${auto ? ' disabled' : ''} aria-label="상태 ${STATUS[s]}"></button>`;
    };
    const demo = '<span class="tag">시연</span>';
    const protoTag = '<span class="proto-tag">프로토타입</span>';
    const text = (n) => `<div class="t">${esc(n.title) || '(이름 없음)'}${n.demo ? demo : ''}</div>${n.desc ? `<div class="d">${esc(n.desc)}</div>` : ''}`;

    const card = (n, g, j) => `<article class="card node st-${statusOf(n)}${n.demo ? ' demo' : ''}${selCls(n)}${hit(n, g) ? '' : ' dim'}" data-id="${esc(n.id)}" tabindex="0" style="--j:${j + 1}">
        ${statusOf(n) === 'proto' ? protoTag : ''}${dot(n)}
        <div class="body">${text(n)}
          ${n.children.length ? `<ul class="subs">${n.children.map((s) => `<li class="sub node${selCls(s)}" data-id="${esc(s.id)}" tabindex="0">${dot(s)}<div class="body">${text(s)}</div></li>`).join('')}</ul>` : ''}
          ${n.note ? `<div class="memo">${esc(n.note)}</div>` : ''}
        </div>
      </article>`;

    const col = (g, i, all) => {
      const t = tally(g.children), s = statusOf(g);
      const solo = !g.children.length;
      return `<section class="col${i === 0 ? ' first' : ''}${i === all.length - 1 ? ' last' : ''}" style="--i:${i + 1}">
        <div class="head node st-${s}${solo ? ' solo' : ''}${g.demo ? ' demo' : ''}${selCls(g)}${solo && !hit(g, g) ? ' dim' : ''}" data-id="${esc(g.id)}" tabindex="0">
          ${solo && s === 'proto' ? protoTag : ''}<div class="h-row">${solo || s === 'done' ? dot(g) : ''}<span class="h-title">${esc(g.title) || '(이름 없음)'}</span>${solo ? '' : `<span class="h-count">${t.done}/${t.total}</span>`}</div>
          ${g.desc ? `<div class="h-desc">${esc(g.desc)}</div>` : ''}
        </div>
        <div class="stack">${g.children.map((n, j) => card(n, g, j)).join('')}<button class="add" data-add="${esc(g.id)}" style="--j:${g.children.length + 1}">+ 항목</button></div>
      </section>`;
    };

    const last = b.children.length + 1;
    const canvas = $('#canvas');
    canvas.innerHTML = `<div class="flow${b.flow ? ' is-flow' : ''}${b.start ? ' has-start' : ''}${b.end ? ' has-end' : ''}${state.enter ? ' enter' : ''}">
      ${b.start ? `<div class="endpoint start"><div class="dot">${esc(b.start)}</div></div>` : ''}
      ${b.children.map(col).join('')}
      ${b.end ? `<div class="endpoint end" style="--i:${last}"><div class="dot">${esc(b.end)}</div></div>` : ''}
      <button class="add add-col" data-add="${esc(b.id)}" style="--i:${last}">+ 섹션</button>
    </div>`;
    state.enter = false;
    if (state.flash) {
      canvas.querySelector(`.node[data-id="${CSS.escape(state.flash.id)}"]`)?.classList.add(state.flash.kind);
      state.flash = null;
    }
  }

  function showPanel(el, html) {
    el.classList.toggle('in', el.hidden);
    el.hidden = false;
    el.innerHTML = html;
  }

  function renderPanel() {
    const el = $('#panel');
    if (state.panel === 'changes') return renderChanges(el);
    const e = state.panel === 'node' && index(state.local).get(state.selId);
    if (!e) { el.hidden = true; el.innerHTML = ''; return; }
    const n = e.node, isBoard = e.depth === 1, auto = n.children.length > 0;
    const sibs = e.parent.children, i = sibs.indexOf(n);
    const groups = e.depth === 3 ? index(state.local).get(e.parent.id).parent.children : [];
    const field = (name, lab, tag = 'input', extra = '') => tag === 'input'
      ? `<label>${lab}<input type="text" data-f="${name}" value="${esc(n[name])}" ${extra}></label>`
      : `<label>${lab}<textarea data-f="${name}" ${extra}>${esc(n[name])}</textarea></label>`;

    showPanel(el, `<div class="p-head"><div class="crumb">${esc(e.path.join(' › ') || '보드')}</div><button class="x" data-close aria-label="닫기">✕</button></div>
      ${field('title', '이름')}
      ${isBoard
        ? `${field('start', '시작 표시', 'textarea', 'rows="2"')}${field('end', '끝 표시', 'textarea', 'rows="2"')}
           <label class="check"><input type="checkbox" data-f="flow"${n.flow ? ' checked' : ''}>순서가 있는 흐름</label>`
        : `${field('desc', '설명', 'textarea', 'rows="3"')}
           <div class="field">상태${auto
             ? `<div class="auto">${STATUS[statusOf(n)]} · 하위 ${tally(n.children).done}/${tally(n.children).total} 완료 (자동)</div>`
             : `<div class="seg" role="radiogroup">${Object.entries(STATUS).map(([k, v]) => `<button type="button" role="radio" data-status="${k}" aria-checked="${n.status === k}">${v}</button>`).join('')}</div>`}
           </div>
           <label class="check"><input type="checkbox" data-f="demo"${n.demo ? ' checked' : ''}>영상 시연 항목</label>
           ${field('note', '메모', 'textarea', 'rows="3"')}
           <div class="sep"></div>
           <div class="row">
             <button class="btn small" data-act="up"${i === 0 ? ' disabled' : ''}>앞으로</button>
             <button class="btn small" data-act="down"${i === sibs.length - 1 ? ' disabled' : ''}>뒤로</button>
             ${groups.length > 1 ? `<select data-move aria-label="다른 섹션으로 이동"><option value="">다른 섹션으로…</option>${groups.filter((g) => g.id !== e.parent.id).map((g) => `<option value="${esc(g.id)}">${esc(g.title)}</option>`).join('')}</select>` : ''}
           </div>
           <div class="row">
             ${e.depth < MAX_DEPTH ? `<button class="btn small" data-act="child">+ 하위 항목</button>` : ''}
             <span class="grow"></span>
             <button class="btn small danger" data-act="del">삭제</button>
           </div>`}
      ${n.updatedAt ? `<div class="meta">최종 수정 ${esc(n.updatedBy || '익명')} · ${when(n.updatedAt)}</div>` : ''}`);
  }

  function renderChanges(el) {
    const ch = changes(), log = state.local.log;
    showPanel(el, `<div class="p-head"><h2 class="grow">변경 기록</h2><button class="x" data-close aria-label="닫기">✕</button></div>
      <h3>저장 전 변경 ${ch.length}건</h3>
      ${ch.length ? `<ul class="list">${ch.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ul>
        <div class="row"><button class="btn small primary" data-act="save">저장</button><button class="btn small danger" data-act="discard">모두 되돌리기</button></div>`
        : '<p class="none">저장할 변경이 없습니다.</p>'}
      <h3>저장된 기록</h3>
      ${log.length ? `<ul class="list">${log.map((l) => `<li><time>${when(l.at)}</time><span class="by">${esc(l.by || '익명')}</span>${esc(l.text)}</li>`).join('')}</ul>` : '<p class="none">아직 기록이 없습니다.</p>'}
      ${online ? `<h3>이전 판으로 되돌리기</h3>${versionList()}` : ''}`);
    if (online && !state.versions && !state.loadingVersions) {
      state.loadingVersions = true;
      loadVersions().finally(() => { state.loadingVersions = false; });
    }
  }
  function versionList() {
    if (!state.versions) return '<p class="none">불러오는 중…</p>';
    if (!state.versions.length) return '<p class="none">저장된 판이 없습니다.</p>';
    return `<ul class="list">${state.versions.map((v) => `<li class="ver"><div><time>${when(v.created_at)}</time><span class="by">${esc(v.author || '익명')}</span>${esc(v.summary || '(요약 없음)')}</div>${
      v.id === state.version ? '<span class="now">현재</span>' : `<button class="btn small" data-restore="${v.id}">불러오기</button>`}</li>`).join('')}</ul>`;
  }

  let toastTimer;
  function toast(msg, err) {
    const el = $('#toast');
    el.textContent = msg; el.className = 'toast' + (err ? ' err' : ''); el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, err ? 6000 : 2600);
  }

  // ── 편집 동작 ─────────────────────────────────────────────
  function select(id) { state.selId = id; state.panel = 'node'; render(); }
  function closePanel() { state.panel = null; state.selId = null; render(); }

  function addChild(parentId) {
    const e = index(state.local).get(parentId);
    if (!e || e.depth >= MAX_DEPTH) return;
    const n = normNode({ title: e.depth === 1 ? '새 섹션' : '새 항목' }, e.depth + 1);
    touch(n);
    e.node.children.push(n);
    persist();
    state.flash = { id: n.id, kind: 'added' };
    select(n.id);
    const input = $('#panel [data-f="title"]');
    input?.focus(); input?.select();
    document.querySelector(`.node[data-id="${n.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function act(name) {
    const ix = index(state.local), e = ix.get(state.selId);
    if (name === 'save') return save();
    if (name === 'discard') {
      if (!confirm('저장하지 않은 변경을 모두 되돌릴까요?')) return;
      state.local = clone(state.base);
      return commit();
    }
    if (!e) return;
    const sibs = e.parent.children, i = sibs.indexOf(e.node);
    if (name === 'up' && i > 0) { sibs.splice(i - 1, 0, sibs.splice(i, 1)[0]); return commit(); }
    if (name === 'down' && i < sibs.length - 1) { sibs.splice(i + 1, 0, sibs.splice(i, 1)[0]); return commit(); }
    if (name === 'child') return addChild(e.node.id);
    if (name === 'del') {
      const kids = index({ boards: [e.node] }).size - 2;
      if (kids > 0 && !confirm(`「${e.node.title}」와 하위 항목 ${kids}개를 삭제할까요?`)) return;
      sibs.splice(i, 1);
      state.panel = null; state.selId = null;
      return commit();
    }
  }

  // ── 저장 ──────────────────────────────────────────────────
  async function save() {
    const ch = changes();
    if (!ch.length || state.saving) return;
    if (!online) return toast('저장할 곳이 연결되지 않았습니다. config.js를 확인하세요.', true);
    state.saving = true; renderTop();
    try {
      for (let attempt = 0; ; attempt++) {
        const cur = await latest();
        const remote = cur ? cur.data : state.base;
        const merged = normalize(same(remote, state.base) ? state.local : rebase(state.base, state.local, remote));
        const at = new Date().toISOString();
        merged.log = [...ch.map((c) => ({ at, by: cfg.name || '', text: c.text })), ...remote.log].slice(0, LOG_LIMIT);
        const r = await api('POST', '?select=id', {
          parent_id: cur ? cur.version : null,
          data: merged,
          author: cfg.name.slice(0, 40),
          summary: `${ch[0].text}${ch.length > 1 ? ` 외 ${ch.length - 1}건` : ''}`.slice(0, 300),
        });
        if (r.status === 409 && attempt < 4) continue; // 방금 다른 사람이 저장함 → 최신 판에 다시 합쳐서 시도
        if (r.status === 429) throw new Error('지금 저장이 몰리고 있습니다. 1분쯤 뒤에 다시 시도하세요.');
        if (!r.ok) throw new Error(`저장에 실패했습니다 (${r.status}).`);
        state.version = (await r.json())[0].id;
        state.base = merged; state.local = clone(merged); state.source = 'online'; state.loadedAt = Date.now();
        state.versions = null;
        persist();
        toast(`${ch.length}건 저장했습니다.`);
        break;
      }
    } catch (err) {
      toast(err.message || '저장에 실패했습니다.', true);
    } finally {
      state.saving = false; render();
    }
  }

  // 다른 사람이 저장한 내용을 가져온다. 연결이 안 되면 지금 화면을 그대로 둔다.
  async function refresh() {
    if (!online || state.saving) return;
    try {
      const cur = await latest();
      state.loadedAt = Date.now();
      if (!cur || state.saving) return;
      state.version = cur.version; state.source = 'online'; state.versions = null;
      if (same(cur.data, state.base)) return renderTop();
      adopt(cur.data);
      // 패널에 글을 쓰는 중이면 입력이 끊기지 않게 패널은 그대로 둔다.
      const typing = $('#panel').contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (typing && state.panel === 'node') { renderTop(); renderCanvas(); } else render();
      toast('다른 사람이 저장한 최신 내용을 반영했습니다.');
    } catch { /* 다음 기회에 */ }
  }
  async function poll() {
    if (!online || document.hidden || state.saving || !state.base) return;
    try {
      const [row] = await rows('?select=id&order=id.desc&limit=1');
      if (row && row.id !== state.version) refresh();
    } catch { /* 다음 기회에 */ }
  }

  // ── 이전 판 ───────────────────────────────────────────────
  async function loadVersions() {
    try {
      state.versions = await rows('?select=id,author,summary,created_at&order=id.desc&limit=30');
    } catch { state.versions = []; toast('이전 판 목록을 불러오지 못했습니다.', true); }
    if (state.panel === 'changes') renderPanel();
  }
  async function restore(id) {
    if (!confirm('이 판의 내용을 불러올까요?')) return;
    try {
      const [row] = await rows(`?select=data&id=eq.${Number(id)}`);
      if (!row) throw new Error('그 판을 찾을 수 없습니다.');
      const old = normalize(row.data);
      old.log = state.local.log; // 기록은 지금 것을 이어 간다
      state.local = old; state.selId = null;
      commit();
      toast('불러왔습니다.');
    } catch (err) { toast(err.message, true); }
  }

  // ── 설정 창 ───────────────────────────────────────────────
  function openSettings() {
    $('#settingsForm').elements.name.value = cfg.name;
    $('#settings').showModal();
  }
  function applySettings() {
    cfg.name = $('#settingsForm').elements.name.value.trim().slice(0, 40);
    writeStore(CFG_KEY, cfg.name ? { name: cfg.name } : null);
  }

  // ── 이벤트 ────────────────────────────────────────────────
  $('#canvas').addEventListener('click', (ev) => {
    const st = ev.target.closest('[data-st]');
    if (st && !st.disabled) {
      const n = index(state.local).get(st.dataset.st)?.node;
      if (n) { n.status = NEXT[n.status]; touch(n); state.flash = { id: n.id, kind: 'flash' }; commit(); }
      return;
    }
    const add = ev.target.closest('[data-add]');
    if (add) return addChild(add.dataset.add);
    const node = ev.target.closest('.node');
    if (node) return select(node.dataset.id);
    if (state.panel) closePanel();
  });
  $('#canvas').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.classList.contains('node')) select(ev.target.dataset.id);
  });

  $('#tabs').addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-board]');
    if (t) {
      if (t.dataset.board === state.boardId) return;
      state.boardId = t.dataset.board; state.selId = null; state.enter = true;
      if (state.panel === 'node') state.panel = null;
      $('#canvas').scrollTo(0, 0);
      return render();
    }
    if (ev.target.closest('[data-board-edit]')) {
      // 이미 이 보드 설정이 열려 있으면 닫는다.
      if (state.panel === 'node' && state.selId === board().id) closePanel(); else select(board().id);
    }
  });
  // 탭 목록 안에서는 ←/→ 로 보드를 옮겨 다닌다.
  $('#tabs').addEventListener('keydown', (ev) => {
    if (!ev.target.matches('.tab') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    const tabs = [...$('#tabs').querySelectorAll('.tab')];
    const i = tabs.indexOf(ev.target), n = tabs.length;
    const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + n) % n;
    ev.preventDefault();
    tabs[j].click();
    tabs[j].focus();
  });
  $('#filters').addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-filter]');
    if (c) { state.filter = c.dataset.filter; renderTop(); applyFilter(); }
  });

  const panel = $('#panel');
  panel.addEventListener('input', (ev) => {
    const f = ev.target.dataset.f;
    const n = f && index(state.local).get(state.selId)?.node;
    if (!n) return;
    n[f] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
    touch(n);
    commit(false);
  });
  panel.addEventListener('change', (ev) => {
    if (!ev.target.matches('[data-move]') || !ev.target.value) return;
    const ix = index(state.local), e = ix.get(state.selId), to = ix.get(ev.target.value);
    if (!e || !to) return;
    e.parent.children.splice(e.parent.children.indexOf(e.node), 1);
    to.node.children.push(e.node);
    touch(e.node);
    commit();
  });
  panel.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-close]')) return closePanel();
    const s = ev.target.closest('[data-status]');
    if (s) {
      const n = index(state.local).get(state.selId)?.node;
      if (n && n.status !== s.dataset.status) { n.status = s.dataset.status; touch(n); state.flash = { id: n.id, kind: 'flash' }; commit(); }
      return;
    }
    const v = ev.target.closest('[data-restore]');
    if (v) return restore(v.dataset.restore);
    const a = ev.target.closest('[data-act]');
    if (a) act(a.dataset.act);
  });

  $('#btnSave').addEventListener('click', save);
  $('#btnChanges').addEventListener('click', () => { state.panel = state.panel === 'changes' ? null : 'changes'; state.selId = null; render(); });
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnSettingsCancel').addEventListener('click', () => $('#settings').close());
  $('#settingsForm').addEventListener('submit', applySettings);
  $('#btnExport').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state.local, null, 2) + '\n'], { type: 'application/json' }));
    a.download = 'data.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && state.panel && !$('#settings').open) closePanel();
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.base && Date.now() - state.loadedAt > 15_000) refresh();
  });
  setInterval(poll, 30_000);

  // ── 시작 ──────────────────────────────────────────────────
  (async () => {
    try {
      const remote = await fetchRemote();
      state.source = remote.source; state.version = remote.version; state.loadedAt = Date.now();
      const draft = readStore(DRAFT_KEY);
      if (draft?.base && draft?.local) { state.base = normalize(draft.base); state.local = normalize(draft.local); }
      adopt(remote.data);
      state.boardId = state.local.boards[0]?.id;
      state.enter = true;
      render();
    } catch (err) {
      $('#canvas').innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    }
  })();

  window.__board = { state, diff, rebase, normalize, index };
})();
