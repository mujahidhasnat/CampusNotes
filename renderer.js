// ---------- ধ্রুবক ----------
const SEMESTERS = [
  'Semester 1', 'Semester 2', 'Semester 3', 'Semester 4',
  'Semester 5', 'Semester 6', 'Semester 7', 'Semester 8'
];
const TYPES = ['Note', 'PDF', 'Question', 'Lab Report', 'Other'];
const EXAM_KINDS = ['Mid', 'Final', 'Class Test', 'Quiz', 'Assignment', 'Other'];
const DAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5]; // শনিবার থেকে শুরু
const TAB_LABELS = { all: 'সব', written: 'লেখা নোট', qbank: 'প্রশ্নব্যাংক', progress: 'প্রগ্রেস', info: 'কোর্স ইনফো' };

const ICONS = {
  '.pdf': '📕', '.doc': '📘', '.docx': '📘',
  '.ppt': '📙', '.pptx': '📙', '.xls': '📗', '.xlsx': '📗',
  '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️',
  '.txt': '📝', '.md': '📝', '.zip': '🗜️'
};
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const TEXT_EXTS = ['.txt', '.md', '.csv', '.json', '.js', '.py', '.c', '.cpp', '.java', '.html', '.css', '.log'];

// ---------- অবস্থা ----------
let db = { courses: [], files: [], notes: [], exams: [], routine: [], chapters: [] };
let page = 'home'; // 'home' | 'course' | 'planner'
let selectedCourseId = null;
let tab = 'all';
let viewing = null; // { kind: 'file' | 'note', id }
let selectMode = false;
let selectedIds = [];
let mergeName = '';
let collapsed = {};
try { collapsed = JSON.parse(localStorage.getItem('collapsed') || '{}'); } catch { collapsed = {}; }

// ---------- সাহায্যকারী ফাংশন ----------
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function btn(label, onClick, cls = '') {
  const b = el('button', cls, label);
  b.addEventListener('click', onClick);
  return b;
}

function field(type, placeholder, value = '') {
  const i = el('input');
  i.type = type;
  i.placeholder = placeholder;
  i.value = value;
  return i;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
function bn(v) {
  return String(v).replace(/\d/g, (d) => BN_DIGITS[d]);
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function iconFor(name) {
  return ICONS[extOf(name)] || '📄';
}

function courseOf(id) {
  return db.courses.find((c) => c.id === id);
}

function daysLeft(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}

function leftLabel(n) {
  if (n < 0) return 'শেষ হয়েছে';
  if (n === 0) return 'আজ!';
  if (n === 1) return 'কাল';
  return bn(n) + ' দিন বাকি';
}

function fmtDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB');
}

function showMessage(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ---------- নোট অটো-সেভ ----------
let saveTimer = null;
let pendingSave = null;

async function flushSave() {
  clearTimeout(saveTimer);
  if (pendingSave) {
    const fn = pendingSave;
    pendingSave = null;
    await fn();
  }
}

// ---------- নেভিগেশন ----------
async function navigate(p, courseId = null, newTab = 'all') {
  await flushSave();
  page = p;
  selectedCourseId = courseId;
  tab = newTab;
  viewing = null;
  selectMode = false;
  selectedIds = [];
  $('globalSearch').value = '';
  $('search').value = '';
  render();
}

async function closeViewer() {
  await flushSave();
  viewing = null;
  render();
}

function openInApp(kind, item) {
  page = 'course';
  selectedCourseId = item.courseId;
  if (tab === 'progress' || tab === 'info') tab = 'all';
  viewing = { kind, id: item.id };
  selectMode = false;
  $('globalSearch').value = '';
  item.lastOpenedAt = Date.now();
  window.api.touch(kind, item.id);
  render();
}

async function openExternal(id) {
  const error = await window.api.openFile(id);
  if (error) showMessage('ফাইল খোলা যায়নি: ' + error);
}

// মোছার বাটন: প্রথম ক্লিকে "নিশ্চিত?", ৩ সেকেন্ডের মধ্যে আবার ক্লিক করলে মুছবে
function confirmClick(button, action) {
  let armed = false;
  const original = button.textContent;
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!armed) {
      armed = true;
      button.textContent = 'নিশ্চিত?';
      button.classList.add('armed');
      setTimeout(() => {
        armed = false;
        button.textContent = original;
        button.classList.remove('armed');
      }, 3000);
    } else {
      action();
    }
  });
}

// ---------- Markdown (নিরাপদভাবে দেখানো) ----------
function renderMarkdownInto(target, md) {
  if (!window.marked) {
    target.textContent = md;
    return;
  }
  const html = window.marked.parse(md || '', { breaks: true, gfm: true });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,iframe,object,embed,style,link,meta,form').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((n) => {
    [...n.attributes].forEach((a) => {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
    });
  });
  target.replaceChildren(...doc.body.childNodes);
}

// ---------- সার্চ ----------
function matches(kind, data, q, includeCourse) {
  const parts = kind === 'note'
    ? [data.title, data.content]
    : [data.name, data.type, data.exam || '', data.year || ''];
  if (includeCourse) {
    const c = courseOf(data.courseId);
    if (c) parts.push(c.name);
  }
  parts.push(...(data.tags || []));
  return parts.join(' ').toLowerCase().includes(q);
}

function courseItems(courseId) {
  return [
    ...db.files
      .filter((f) => f.courseId === courseId)
      .map((f) => ({ kind: 'file', data: f, time: f.addedAt, fav: f.favorite ? 1 : 0 })),
    ...db.notes
      .filter((n) => n.courseId === courseId)
      .map((n) => ({ kind: 'note', data: n, time: n.updatedAt, fav: 0 }))
  ];
}

// ---------- সাইডবার ----------
function renderSidebar() {
  const gq = $('globalSearch').value.trim();
  $('homeBtn').classList.toggle('active', page === 'home' && !gq);
  $('plannerBtn').classList.toggle('active', page === 'planner' && !gq);

  const list = $('courseList');
  list.replaceChildren();

  if (db.courses.length === 0) {
    list.append(el('p', 'hint', 'এখনো কোনো কোর্স নেই। নিচ থেকে যোগ করো।'));
    return;
  }

  SEMESTERS.forEach((sem) => {
    const courses = db.courses.filter((c) => c.semester === sem);
    if (!courses.length) return;

    const isCollapsed = !!collapsed[sem];
    const head = el('div', 'sem-title toggle', (isCollapsed ? '▸ ' : '▾ ') + sem + ' (' + bn(courses.length) + ')');
    head.addEventListener('click', () => {
      collapsed[sem] = !collapsed[sem];
      localStorage.setItem('collapsed', JSON.stringify(collapsed));
      renderSidebar();
    });
    list.append(head);
    if (isCollapsed) return;

    courses.forEach((c) => {
      const active = page === 'course' && c.id === selectedCourseId && !gq;
      const row = el('div', 'course' + (active ? ' active' : ''));
      const count = courseItems(c.id).length;

      const del = el('button', 'icon-btn', '✕');
      del.title = 'কোর্স মুছো (ভেতরের সব ফাইল, নোট, প্রগ্রেসসহ)';
      confirmClick(del, async () => {
        db = await window.api.deleteCourse(c.id);
        if (selectedCourseId === c.id) {
          selectedCourseId = null;
          viewing = null;
          page = 'home';
        }
        render();
      });

      row.append(el('span', 'course-name', c.name), el('span', 'count', bn(count)), del);
      row.addEventListener('click', () => navigate('course', c.id));
      list.append(row);
    });
  });
}

// ---------- হোম স্ক্রিন ----------
function miniRow(kind, data) {
  const course = courseOf(data.courseId);
  const isNote = kind === 'note';
  const row = el('div', 'mini');
  const info = el('div', 'file-info');
  info.append(el('div', 'file-name', isNote ? data.title : data.name));
  info.append(el('div', 'file-meta', (course ? course.name : '') + ' · ' + (isNote ? 'লেখা নোট' : data.type)));
  row.append(el('div', 'file-icon', isNote ? '📝' : iconFor(data.name)), info);
  row.title = 'ক্লিক করলে অ্যাপের ভেতরে খুলবে';
  row.addEventListener('click', () => openInApp(kind, data));
  return row;
}

function examRow(ex, withDelete) {
  const n = daysLeft(ex.date);
  const c = courseOf(ex.courseId);
  const row = el('div', 'mini exam' + (n >= 0 && n <= 3 ? ' soon' : ''));
  const info = el('div', 'file-info');
  info.append(
    el('div', 'file-name', ex.title),
    el('div', 'file-meta', [c ? c.name : '', fmtDate(ex.date), ex.time, ex.room].filter(Boolean).join(' · '))
  );
  row.append(el('div', 'countdown' + (n < 0 ? ' past' : ''), leftLabel(n)), info);

  if (withDelete) {
    const del = el('button', 'icon-btn', '🗑️');
    del.title = 'মুছো';
    confirmClick(del, async () => {
      db = await window.api.listDelete('exams', ex.id);
      render();
    });
    row.append(del);
  } else {
    row.addEventListener('click', () => navigate('planner'));
  }
  return row;
}

function sortedExams() {
  return [...db.exams]
    .filter((x) => x.date)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

function renderHome(list) {
  const home = el('div', 'home');

  const hero = el('div', 'hero');
  hero.append(
    el('div', 'logo', '📚'),
    el('h1', '', 'CampusNotes'),
    el('p', '', 'আমার ডিপার্টমেন্টের সব নোট এক জায়গায়')
  );
  home.append(hero);

  const stats = el('div', 'stats');
  [
    [db.courses.length, 'কোর্স'],
    [db.files.length, 'মোট ফাইল'],
    [db.notes.length, 'লেখা নোট'],
    [db.files.filter((f) => f.favorite).length, 'ফেভারিট']
  ].forEach(([num, label]) => {
    const card = el('div', 'stat');
    card.append(el('div', 'num', bn(num)), el('div', 'label', label));
    stats.append(card);
  });
  home.append(stats);

  if (db.courses.length === 0) {
    const box = el('div', 'box');
    box.append(el('h3', '', '🚀 শুরু করার নিয়ম'));
    const ol = el('ol', 'steps');
    [
      'বাম পাশ থেকে সেমিস্টার বেছে কোর্সের নাম লিখে "কোর্স যোগ করো" চাপো',
      'কোর্স খুললে "ফাইল যোগ করো" চাপো, অথবা PDF/DOCX/PPT টেনে এনে ছেড়ে দাও',
      '"নোট লেখো" চেপে Markdown-এ নিজের নোট লিখে ফেলো',
      '"রুটিন ও পরীক্ষা" থেকে ক্লাস রুটিন আর পরীক্ষার তারিখ বসাও',
      'মাঝে মাঝে "ব্যাকআপ" চেপে সব ডেটা zip করে রাখো'
    ].forEach((t) => ol.append(el('li', '', t)));
    box.append(ol);
    home.append(box);
    list.append(home);
    return;
  }

  const cols = el('div', 'home-cols');

  // পরীক্ষা কাউন্টডাউন
  const exBox = el('div', 'box');
  exBox.append(el('h3', '', '⏳ পরীক্ষা কাউন্টডাউন'));
  const upcoming = sortedExams().filter((x) => daysLeft(x.date) >= 0).slice(0, 4);
  if (upcoming.length) upcoming.forEach((x) => exBox.append(examRow(x, false)));
  else exBox.append(el('p', 'hint', 'আসন্ন পরীক্ষা নেই। "রুটিন ও পরীক্ষা" থেকে যোগ করো'));

  // আজকের ক্লাস
  const today = new Date().getDay();
  const classBox = el('div', 'box');
  classBox.append(el('h3', '', '🗓️ আজকের ক্লাস (' + DAYS[today] + ')'));
  const todays = db.routine.filter((r) => r.day === today).sort((a, b) => a.start.localeCompare(b.start));
  if (todays.length) todays.forEach((r) => classBox.append(routineRow(r, false)));
  else classBox.append(el('p', 'hint', 'আজ কোনো ক্লাস নেই 🎉'));

  // সর্বশেষ খোলা
  const recent = el('div', 'box');
  recent.append(el('h3', '', '🕒 সর্বশেষ খোলা'));
  const opened = [
    ...db.files.map((d) => ({ kind: 'file', d })),
    ...db.notes.map((d) => ({ kind: 'note', d }))
  ]
    .filter((x) => x.d.lastOpenedAt)
    .sort((a, b) => b.d.lastOpenedAt - a.d.lastOpenedAt)
    .slice(0, 6);
  if (opened.length) opened.forEach((x) => recent.append(miniRow(x.kind, x.d)));
  else recent.append(el('p', 'hint', 'ফাইল বা নোট খুললে এখানে শর্টকাট আসবে'));

  // ফেভারিট
  const favs = el('div', 'box');
  favs.append(el('h3', '', '⭐ ফেভারিট ফাইল'));
  const favFiles = db.files.filter((f) => f.favorite).slice(0, 6);
  if (favFiles.length) favFiles.forEach((f) => favs.append(miniRow('file', f)));
  else favs.append(el('p', 'hint', 'ফাইলের পাশে ☆ চাপলে এখানে আসবে'));

  cols.append(exBox, classBox, recent, favs);
  home.append(cols);
  list.append(home);
}

// ---------- রুটিন ও পরীক্ষা পেজ ----------
function routineRow(r, withDelete) {
  const c = courseOf(r.courseId);
  const row = el('div', 'mini');
  const info = el('div', 'file-info');
  info.append(
    el('div', 'file-name', c ? c.name : '—'),
    el('div', 'file-meta', r.room ? 'রুম: ' + r.room : '')
  );
  row.append(el('div', 'time-chip', r.start + (r.end ? ' – ' + r.end : '')), info);
  if (withDelete) {
    const del = el('button', 'icon-btn', '🗑️');
    del.title = 'মুছো';
    confirmClick(del, async () => {
      db = await window.api.listDelete('routine', r.id);
      render();
    });
    row.append(del);
  }
  return row;
}

function courseSelect() {
  const s = el('select');
  db.courses.forEach((c) => s.append(new Option(c.name + ' (' + c.semester + ')', c.id)));
  return s;
}

function renderPlanner(list) {
  const wrap = el('div', 'home planner');
  wrap.append(el('h2', 'page-title', '📅 রুটিন ও পরীক্ষা'));

  if (!db.courses.length) {
    const box = el('div', 'box');
    box.append(el('p', 'hint', 'আগে বাম পাশ থেকে অন্তত একটা কোর্স যোগ করো।'));
    wrap.append(box);
    list.append(wrap);
    return;
  }

  const cols = el('div', 'home-cols');

  // ---- পরীক্ষা ----
  const exBox = el('div', 'box');
  exBox.append(el('h3', '', '⏳ পরীক্ষা ও কাউন্টডাউন'));

  const exForm = el('form', 'mini-form');
  const exCourse = courseSelect();
  const exTitle = field('text', 'পরীক্ষার নাম (যেমন: Mid Term)');
  const exDate = field('date', '');
  const exTime = field('time', '');
  const exRoom = field('text', 'রুম (ঐচ্ছিক)');
  exTitle.required = true;
  exDate.required = true;
  exForm.append(exCourse, exTitle, exDate, exTime, exRoom, el('button', 'primary', '+ পরীক্ষা যোগ করো'));
  exForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    db = await window.api.listAdd('exams', exCourse.value, {
      title: exTitle.value, date: exDate.value, time: exTime.value, room: exRoom.value
    });
    render();
  });
  exBox.append(exForm);

  const exams = sortedExams();
  if (exams.length) exams.forEach((x) => exBox.append(examRow(x, true)));
  else exBox.append(el('p', 'hint', 'এখনো কোনো পরীক্ষা যোগ করা হয়নি'));

  // ---- ক্লাস রুটিন ----
  const rBox = el('div', 'box');
  rBox.append(el('h3', '', '🗓️ সাপ্তাহিক ক্লাস রুটিন'));

  const rForm = el('form', 'mini-form');
  const rCourse = courseSelect();
  const rDay = el('select');
  DAY_ORDER.forEach((d) => rDay.append(new Option(DAYS[d], String(d))));
  const rStart = field('time', '');
  const rEnd = field('time', '');
  const rRoom = field('text', 'রুম (ঐচ্ছিক)');
  rStart.required = true;
  rStart.title = 'শুরুর সময়';
  rEnd.title = 'শেষের সময়';
  rForm.append(rCourse, rDay, rStart, rEnd, rRoom, el('button', 'primary', '+ ক্লাস যোগ করো'));
  rForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    db = await window.api.listAdd('routine', rCourse.value, {
      day: rDay.value, start: rStart.value, end: rEnd.value, room: rRoom.value
    });
    render();
  });
  rBox.append(rForm);

  const today = new Date().getDay();
  let any = false;
  DAY_ORDER.forEach((d) => {
    const items = db.routine.filter((r) => r.day === d).sort((a, b) => a.start.localeCompare(b.start));
    if (!items.length) return;
    any = true;
    rBox.append(el('div', 'day-title', DAYS[d] + (d === today ? ' (আজ)' : '')));
    items.forEach((r) => rBox.append(routineRow(r, true)));
  });
  if (!any) rBox.append(el('p', 'hint', 'এখনো কোনো ক্লাস যোগ করা হয়নি'));

  cols.append(exBox, rBox);
  wrap.append(cols);
  list.append(wrap);
}

// ---------- সব কোর্সে সার্চের ফলাফল ----------
function renderSearch(list, raw) {
  const q = raw.toLowerCase();
  const courses = db.courses.filter((c) => c.name.toLowerCase().includes(q));
  const items = [
    ...db.files.map((d) => ({ kind: 'file', data: d })),
    ...db.notes.map((d) => ({ kind: 'note', data: d }))
  ].filter(({ kind, data }) => matches(kind, data, q, true));

  list.append(el('h3', 'page-title', '🔍 "' + raw + '" — ' + bn(courses.length + items.length) + 'টি ফলাফল'));

  if (!courses.length && !items.length) {
    list.append(el('div', 'empty', 'কিছু পাওয়া যায়নি।'));
    return;
  }

  courses.forEach((c) => {
    const row = el('div', 'file');
    const info = el('div', 'file-info clickable');
    info.append(el('div', 'file-name', c.name), el('div', 'file-meta', 'কোর্স · ' + c.semester));
    info.addEventListener('click', () => navigate('course', c.id));
    row.append(el('div', 'file-icon', '📁'), info, btn('খোলো', () => navigate('course', c.id)));
    list.append(row);
  });

  items.forEach(({ kind, data }) => list.append(itemRow(kind, data, { showCourse: true })));
}

// ---------- ফাইল/নোটের সারি ----------
function itemRow(kind, data, opts = {}) {
  const isNote = kind === 'note';
  const row = el('div', 'file');
  let cb = null;

  if (opts.selectable) {
    cb = el('input');
    cb.type = 'checkbox';
    cb.checked = selectedIds.includes(data.id);
    cb.addEventListener('change', () => {
      selectedIds = selectedIds.includes(data.id)
        ? selectedIds.filter((x) => x !== data.id)
        : [...selectedIds, data.id];
      const top = $('fileList').scrollTop;
      render();
      $('fileList').scrollTop = top;
    });
    row.append(cb);
  }

  const info = el('div', 'file-info clickable');
  info.append(el('div', 'file-name', isNote ? data.title : data.name));

  const meta = el('div', 'file-meta');
  meta.append(el('span', 'badge', isNote ? 'লেখা নোট' : data.type));
  if (opts.showCourse) {
    const c = courseOf(data.courseId);
    if (c) meta.append(el('span', 'badge course-badge', c.name));
  }
  if (!isNote && data.type === 'Question' && (data.exam || data.year)) {
    meta.append(el('span', 'badge', [data.exam, data.year].filter(Boolean).join(' ')));
  }
  (data.tags || []).forEach((t) => {
    const tg = el('span', 'tag', '#' + t);
    tg.title = 'এই ট্যাগের সব আইটেম দেখো';
    tg.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = opts.showCourse ? $('globalSearch') : $('search');
      target.value = t;
      render();
    });
    meta.append(tg);
  });
  meta.append(document.createTextNode(new Date(isNote ? data.updatedAt : data.addedAt).toLocaleDateString('en-GB')));
  info.append(meta);
  info.addEventListener('click', cb ? () => cb.click() : () => openInApp(kind, data));
  row.append(el('div', 'file-icon', isNote ? '📝' : iconFor(data.name)), info);

  if (!opts.selectable) {
    if (!isNote) {
      const star = el('button', 'icon-btn star', data.favorite ? '⭐' : '☆');
      star.title = 'ফেভারিট';
      star.addEventListener('click', async () => {
        db = await window.api.toggleFavorite(data.id);
        render();
      });
      row.append(star);
    }
    row.append(btn(isNote ? 'খোলো' : 'দেখো', () => openInApp(kind, data)));

    const del = el('button', 'icon-btn', '🗑️');
    del.title = isNote ? 'নোট মুছো' : 'ফাইল মুছো';
    confirmClick(del, async () => {
      db = isNote ? await window.api.deleteNote(data.id) : await window.api.deleteFile(data.id);
      render();
    });
    row.append(del);
  }
  return row;
}

// ---------- কোর্স পেজ ----------
function renderTabs(course) {
  const nav = $('tabs');
  nav.replaceChildren();

  const files = db.files.filter((f) => f.courseId === course.id);
  const notes = db.notes.filter((n) => n.courseId === course.id);
  const chs = db.chapters.filter((c) => c.courseId === course.id);
  const pct = chs.length ? Math.round((chs.filter((c) => c.done).length * 100) / chs.length) + '%' : '';

  const defs = [
    ['all', '📁 সব', files.length + notes.length],
    ...TYPES.map((t) => [t, t, files.filter((f) => f.type === t).length]),
    ['written', '✍️ লেখা নোট', notes.length],
    ['qbank', '🗂️ প্রশ্নব্যাংক', files.filter((f) => f.type === 'Question').length],
    ['progress', '📈 প্রগ্রেস', pct],
    ['info', 'ℹ️ কোর্স ইনফো', '']
  ];

  defs.forEach(([key, label, count]) => {
    const b = el('button', 'tab' + (tab === key ? ' active' : ''), label + (count !== '' ? ' ' + bn(count) : ''));
    b.addEventListener('click', () => {
      tab = key;
      selectMode = false;
      selectedIds = [];
      if (TYPES.includes(key)) $('typeSelect').value = key;
      if (key === 'qbank') $('typeSelect').value = 'Question';
      syncAddBar();
      render();
    });
    nav.append(b);
  });
}

function mergeTools() {
  const bar = el('div', 'list-tools');
  if (!['all', 'PDF'].includes(tab)) return bar;

  if (!selectMode) {
    bar.append(btn('🔗 PDF মার্জ', () => {
      selectMode = true;
      selectedIds = [];
      render();
    }));
    return bar;
  }

  const name = field('text', 'নতুন ফাইলের নাম (ঐচ্ছিক)', mergeName);
  name.addEventListener('input', () => (mergeName = name.value));

  const go = btn('মার্জ করো (' + bn(selectedIds.length) + ')', async () => {
    const res = await window.api.mergePdfs(selectedCourseId, selectedIds, mergeName);
    db = res.db;
    if (res.error) {
      showMessage(res.error);
    } else {
      showMessage('PDF মার্জ হয়েছে ✓');
      selectMode = false;
      selectedIds = [];
      mergeName = '';
    }
    render();
  }, 'primary');
  go.disabled = selectedIds.length < 2;

  bar.append(
    el('span', 'muted', 'যে ক্রমে টিক দেবে, সেই ক্রমে PDF জোড়া লাগবে'),
    name,
    go,
    btn('বাতিল', () => {
      selectMode = false;
      selectedIds = [];
      render();
    })
  );
  return bar;
}

function renderItems(list, course) {
  const q = $('search').value.trim().toLowerCase();

  let items = courseItems(course.id).filter(({ kind, data }) => {
    if (tab === 'written') return kind === 'note';
    if (TYPES.includes(tab)) return kind === 'file' && data.type === tab;
    return true;
  });
  const totalInTab = items.length;

  if (q) items = items.filter(({ kind, data }) => matches(kind, data, q, false));
  if (selectMode) items = items.filter(({ kind, data }) => kind === 'file' && extOf(data.name) === '.pdf');
  items.sort((a, b) => b.fav - a.fav || b.time - a.time);

  list.append(mergeTools());

  if (items.length === 0) {
    const msg = selectMode
      ? 'মার্জ করার মতো PDF নেই।'
      : totalInTab === 0
        ? 'এখানে এখনো কিছু নেই।\n"ফাইল যোগ করো" বা "নোট লেখো" চাপো, অথবা ফাইল এখানে টেনে এনে ছেড়ে দাও।'
        : 'কিছু পাওয়া যায়নি।';
    list.append(el('div', 'empty', msg));
    return;
  }

  items.forEach(({ kind, data }) => list.append(itemRow(kind, data, { selectable: selectMode })));
}

function renderQBank(list, course) {
  const files = db.files.filter((f) => f.courseId === course.id && f.type === 'Question');
  if (!files.length) {
    list.append(el('div', 'empty',
      'এখনো কোনো প্রশ্ন নেই।\nওপরে ধরন "Question" রেখে পরীক্ষার ধরন (Mid/Final) ও বছর বেছে ফাইল যোগ করো।'));
    return;
  }

  const years = [...new Set(files.map((f) => f.year || ''))].sort((a, b) => (b || '0').localeCompare(a || '0'));
  years.forEach((y) => {
    list.append(el('div', 'year-title', '📅 ' + (y ? bn(y) : 'বছর অজানা')));
    files
      .filter((f) => (f.year || '') === y)
      .sort((a, b) => EXAM_KINDS.indexOf(a.exam || 'Other') - EXAM_KINDS.indexOf(b.exam || 'Other'))
      .forEach((f) => list.append(itemRow('file', f)));
  });
}

function renderProgress(list, course) {
  const chapters = db.chapters.filter((c) => c.courseId === course.id);
  const done = chapters.filter((c) => c.done).length;
  const pct = chapters.length ? Math.round((done * 100) / chapters.length) : 0;

  const box = el('div', 'box');
  box.append(el('h3', '', '📈 পড়ার অগ্রগতি'));

  const bar = el('div', 'bar');
  const fill = el('div', 'bar-fill');
  fill.style.width = pct + '%';
  bar.append(fill);
  box.append(bar, el('div', 'muted', bn(done) + '/' + bn(chapters.length) + ' চ্যাপ্টার শেষ (' + bn(pct) + '%)'));

  const form = el('form', 'inline-form');
  const input = field('text', 'নতুন চ্যাপ্টারের নাম (যেমন: Chapter 3: Stack)');
  input.required = true;
  form.append(input, el('button', 'primary', '+ যোগ করো'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    db = await window.api.listAdd('chapters', course.id, { title: input.value });
    render();
  });
  box.append(form);

  if (!chapters.length) box.append(el('p', 'hint', 'এখনো কোনো চ্যাপ্টার যোগ করা হয়নি'));

  chapters.forEach((ch) => {
    const row = el('div', 'chapter' + (ch.done ? ' done' : ''));
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!ch.done;
    cb.addEventListener('change', async () => {
      db = await window.api.listUpdate('chapters', ch.id, { done: cb.checked });
      render();
    });
    const del = el('button', 'icon-btn', '🗑️');
    confirmClick(del, async () => {
      db = await window.api.listDelete('chapters', ch.id);
      render();
    });
    row.append(cb, el('span', 'chapter-title', ch.title), del);
    box.append(row);
  });

  list.append(box);
}

function renderInfo(list, course) {
  const box = el('div', 'box info-card');
  box.append(el('h3', '', 'ℹ️ কোর্স ইনফো কার্ড'));

  const grid = el('div', 'info-grid');
  const inputs = {};

  const nameIn = field('text', 'কোর্সের নাম', course.name);
  const semIn = el('select');
  SEMESTERS.forEach((s) => semIn.append(new Option(s, s)));
  semIn.value = course.semester;
  inputs.name = nameIn;
  inputs.semester = semIn;

  grid.append(el('label', '', 'কোর্সের নাম'), nameIn, el('label', '', 'সেমিস্টার'), semIn);

  [
    ['teacher', '👨‍🏫 শিক্ষকের নাম', 'text'],
    ['email', '✉️ ইমেইল', 'email'],
    ['credit', '🎓 ক্রেডিট', 'text'],
    ['room', '🏫 রুম / ভবন', 'text']
  ].forEach(([key, label, type]) => {
    inputs[key] = field(type, label, course[key] || '');
    grid.append(el('label', '', label), inputs[key]);
  });
  box.append(grid);

  const actions = el('div', 'list-tools');
  actions.append(btn('💾 সেভ করো', async () => {
    const patch = {};
    Object.entries(inputs).forEach(([k, i]) => (patch[k] = i.value));
    db = await window.api.updateCourse(course.id, patch);
    showMessage('কোর্স ইনফো সেভ হয়েছে ✓');
    render();
  }, 'primary'));

  if (course.email) {
    actions.append(btn('✉️ ইমেইল পাঠাও', async () => {
      const ok = await window.api.openMail(course.email);
      if (!ok) showMessage('ইমেইল ঠিকানাটা সঠিক মনে হচ্ছে না');
    }));
  }
  box.append(actions);
  list.append(box);
}

function renderCourse(list, course) {
  $('title').textContent = course.name;
  $('subtitle').textContent = [
    course.semester + ' › ' + (TAB_LABELS[tab] || tab),
    course.teacher && '👨‍🏫 ' + course.teacher,
    course.credit && 'ক্রেডিট ' + course.credit
  ].filter(Boolean).join(' · ');

  renderTabs(course);
  $('controls').classList.toggle('hidden', tab === 'progress' || tab === 'info');
  syncAddBar();

  if (tab === 'progress') renderProgress(list, course);
  else if (tab === 'info') renderInfo(list, course);
  else if (tab === 'qbank') renderQBank(list, course);
  else renderItems(list, course);
}

// ---------- ট্যাগ এডিটর ----------
function tagEditor(kind, startItem) {
  let item = startItem;
  const wrap = el('div', 'tag-editor');
  const chips = el('span', 'chips');
  const input = el('input');
  input.type = 'text';
  input.maxLength = 24;
  input.placeholder = '🏷️ ট্যাগ লিখে Enter দাও (যেমন: পরীক্ষায় আসবে)';

  function drawChips() {
    chips.replaceChildren();
    (item.tags || []).forEach((t) => {
      const chip = el('span', 'tag removable', '#' + t + ' ');
      const x = el('button', 'tag-x', '✕');
      x.title = 'ট্যাগ মুছো';
      x.addEventListener('click', () => save((item.tags || []).filter((y) => y !== t)));
      chip.append(x);
      chips.append(chip);
    });
  }

  async function save(tags) {
    await flushSave();
    db = await window.api.setTags(kind, item.id, tags);
    const list = kind === 'note' ? db.notes : db.files;
    item = list.find((x) => x.id === item.id) || item;
    drawChips();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = input.value.trim().replace(/^#+/, '');
      if (!v) return;
      input.value = '';
      save([...(item.tags || []), v]);
    }
  });

  drawChips();
  wrap.append(chips, input);
  return wrap;
}

// ---------- PDF ভিউয়ার (pdf.js) ----------
let pdfjsPromise = null;
let pdfToken = 0;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('./node_modules/pdfjs-dist/build/pdf.min.mjs')
      .then((m) => {
        m.GlobalWorkerOptions.workerSrc = new URL(
          './node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
          location.href
        ).href;
        return m;
      })
      .catch((err) => {
        pdfjsPromise = null;
        throw err;
      });
  }
  return pdfjsPromise;
}

function buildPdfView(body, pdf, token) {
  let scale = 1.3;
  let renderId = 0;

  const bar = el('div', 'pdf-bar');
  const label = el('span', 'muted', '');
  const pages = el('div', 'pdf-pages');
  body.replaceChildren(bar, pages);

  const zoom = (delta) => {
    scale = Math.min(3, Math.max(0.6, scale + delta));
    draw();
  };
  bar.append(btn('−', () => zoom(-0.2)), label, btn('+', () => zoom(0.2)), el('span', 'muted', bn(pdf.numPages) + ' পৃষ্ঠা'));

  async function draw() {
    const id = ++renderId;
    label.textContent = bn(Math.round(scale * 100)) + '%';
    pages.replaceChildren();

    const first = await pdf.getPage(1);
    const vp1 = first.getViewport({ scale });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(async (en) => {
          if (!en.isIntersecting) return;
          const holder = en.target;
          observer.unobserve(holder);
          if (id !== renderId || token !== pdfToken) return;
          try {
            const page = await pdf.getPage(Number(holder.dataset.page));
            const vp = page.getViewport({ scale });
            const ratio = window.devicePixelRatio || 1;
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(vp.width * ratio);
            canvas.height = Math.floor(vp.height * ratio);
            canvas.style.width = vp.width + 'px';
            canvas.style.height = vp.height + 'px';
            holder.style.width = '';
            holder.style.minHeight = '';
            holder.replaceChildren(canvas);
            await page.render({
              canvasContext: canvas.getContext('2d'),
              viewport: vp,
              transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null
            }).promise;
          } catch (err) {
            console.error('পৃষ্ঠা আঁকা যায়নি:', err);
          }
        });
      },
      { root: body, rootMargin: '700px 0px' }
    );

    for (let i = 1; i <= pdf.numPages; i++) {
      const holder = el('div', 'pdf-page');
      holder.dataset.page = String(i);
      holder.style.width = vp1.width + 'px';
      holder.style.minHeight = vp1.height + 'px';
      pages.append(holder);
      observer.observe(holder);
    }
  }

  draw();
}

async function showPdf(body, f) {
  const token = ++pdfToken;
  body.append(el('div', 'empty', 'PDF লোড হচ্ছে...'));
  try {
    const [pdfjs, data] = await Promise.all([loadPdfJs(), window.api.getFileData(f.id)]);
    if (!data) throw new Error('ফাইল পাওয়া যায়নি');
    const pdf = await pdfjs.getDocument({ data }).promise;
    if (token !== pdfToken) return;
    buildPdfView(body, pdf, token);
  } catch (err) {
    console.error('pdf.js ব্যর্থ:', err);
    if (token !== pdfToken) return;
    // ব্যাকআপ: ব্রাউজারের নিজস্ব PDF ভিউয়ার
    const url = await window.api.getFileUrl(f.id);
    body.replaceChildren();
    if (url) {
      const frame = el('iframe', 'pdf-frame');
      frame.src = url;
      body.append(frame);
    } else {
      body.append(el('div', 'empty', 'PDF খোলা যায়নি।\n"↗ বাইরে খোলো" চেষ্টা করো।'));
    }
  }
}

// ---------- ফাইল ভিউয়ার ----------
async function loadFileBody(body, f) {
  const ext = extOf(f.name);

  if (ext === '.pdf') {
    await showPdf(body, f);
  } else if (IMAGE_EXTS.includes(ext)) {
    const url = await window.api.getFileUrl(f.id);
    if (!url) {
      body.append(el('div', 'empty', 'ফাইলটা পাওয়া যায়নি'));
      return;
    }
    const img = el('img', 'img-view');
    img.src = url;
    body.append(img);
  } else if (TEXT_EXTS.includes(ext)) {
    const text = await window.api.getFileText(f.id);
    if (ext === '.md' && text !== null) {
      const md = el('div', 'md');
      md.style.padding = '16px';
      renderMarkdownInto(md, text);
      body.append(md);
    } else {
      body.append(el('pre', 'text-view', text === null ? 'ফাইল পড়া যায়নি' : text));
    }
  } else {
    body.append(
      el('div', 'empty',
        'এই ধরনের ফাইল (' + (ext || 'অজানা') + ') অ্যাপের ভেতরে দেখানো যায় না।\nওপরের "↗ বাইরে খোলো" বাটন চাপো।')
    );
  }
}

function metaEditor(f) {
  const wrap = el('div', 'meta-editor');

  const typeSel = el('select');
  TYPES.forEach((t) => typeSel.append(new Option(t, t)));
  typeSel.value = f.type;

  const qbox = el('span', 'meta-editor');
  const examSel = el('select');
  EXAM_KINDS.forEach((t) => examSel.append(new Option(t, t)));
  examSel.value = f.exam || 'Mid';
  const year = field('number', 'বছর', f.year || '');
  qbox.append(examSel, year);

  const sync = () => qbox.classList.toggle('hidden', typeSel.value !== 'Question');
  sync();

  async function save() {
    db = await window.api.updateFile(f.id, { type: typeSel.value, exam: examSel.value, year: year.value });
    sync();
    showMessage('সেভ হয়েছে ✓');
  }
  typeSel.addEventListener('change', save);
  examSel.addEventListener('change', save);
  year.addEventListener('change', save);

  wrap.append(el('span', 'muted', 'ধরন:'), typeSel, qbox);
  return wrap;
}

function renderFileViewer(box, f) {
  const bar = el('div', 'viewer-bar');

  const star = el('button', 'icon-btn star', f.favorite ? '⭐' : '☆');
  star.title = 'ফেভারিট';
  star.addEventListener('click', async () => {
    db = await window.api.toggleFavorite(f.id);
    render();
  });

  const del = el('button', 'icon-btn', '🗑️');
  del.title = 'ফাইল মুছো';
  confirmClick(del, async () => {
    db = await window.api.deleteFile(f.id);
    viewing = null;
    render();
  });

  bar.append(
    btn('← ফিরে যাও', closeViewer),
    el('div', 'viewer-title', f.name),
    star,
    btn('⬇️ সেভ করো', async () => {
      if (await window.api.saveFileAs(f.id)) showMessage('ফাইল সেভ হয়েছে ✓');
    }),
    btn('↗ বাইরে খোলো', () => openExternal(f.id)),
    del
  );

  const body = el('div', 'viewer-body');
  box.append(bar, tagEditor('file', f), metaEditor(f), body);
  loadFileBody(body, f);
}

// ---------- নোট এডিটর (Markdown) ----------
function renderNoteEditor(box, n) {
  const bar = el('div', 'viewer-bar');

  const titleInput = el('input', 'note-title');
  titleInput.value = n.title;
  titleInput.placeholder = 'নোটের নাম';
  titleInput.maxLength = 200;

  const status = el('span', 'muted', 'সেভ করা আছে');

  const split = el('div', 'note-split');
  const area = el('textarea', 'note-area');
  area.value = n.content;
  area.placeholder = 'এখানে নোট লেখো... (Markdown চলবে: # শিরোনাম, **মোটা**, - তালিকা, `কোড`)\nনিজে নিজেই সেভ হবে।';
  const preview = el('div', 'md note-preview');
  split.append(area, preview);

  const previewOn = localStorage.getItem('notePreview') === '1';
  split.classList.toggle('with-preview', previewOn);
  if (previewOn) renderMarkdownInto(preview, area.value);

  const pBtn = btn(previewOn ? '👁️ প্রিভিউ বন্ধ' : '👁️ প্রিভিউ', () => {
    const on = split.classList.toggle('with-preview');
    localStorage.setItem('notePreview', on ? '1' : '0');
    pBtn.textContent = on ? '👁️ প্রিভিউ বন্ধ' : '👁️ প্রিভিউ';
    if (on) renderMarkdownInto(preview, area.value);
  });

  const printBtn = btn('🖨️ প্রিন্ট', () => {
    const pa = $('printArea');
    const body = el('div', 'md');
    renderMarkdownInto(body, area.value);
    pa.replaceChildren(el('h1', '', titleInput.value), body);
    window.print();
  });

  const del = el('button', 'icon-btn', '🗑️');
  del.title = 'নোট মুছো';
  confirmClick(del, async () => {
    clearTimeout(saveTimer);
    pendingSave = null;
    db = await window.api.deleteNote(n.id);
    viewing = null;
    render();
  });

  bar.append(btn('← ফিরে যাও', closeViewer), titleInput, status, pBtn, printBtn, del);

  function queueSave() {
    status.textContent = 'সেভ হচ্ছে...';
    pendingSave = async () => {
      await window.api.updateNote(n.id, titleInput.value, area.value);
      const cur = db.notes.find((x) => x.id === n.id) || n;
      cur.title = titleInput.value.trim() || 'নামহীন নোট';
      cur.content = area.value;
      cur.updatedAt = Date.now();
      status.textContent = 'সেভ হয়েছে ✓';
    };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 600);
    if (split.classList.contains('with-preview')) renderMarkdownInto(preview, area.value);
  }

  titleInput.addEventListener('input', queueSave);
  area.addEventListener('input', queueSave);

  box.append(bar, tagEditor('note', n), split);

  if (n.content === '' && n.title === 'নতুন নোট') {
    setTimeout(() => {
      titleInput.focus();
      titleInput.select();
    }, 0);
  }
}

function renderViewer(list) {
  const item =
    viewing.kind === 'note'
      ? db.notes.find((n) => n.id === viewing.id)
      : db.files.find((f) => f.id === viewing.id);

  if (!item) {
    viewing = null;
    render();
    return;
  }

  const box = el('div', 'viewer');
  if (viewing.kind === 'note') renderNoteEditor(box, item);
  else renderFileViewer(box, item);
  list.append(box);
}

// ---------- মূল অংশ আঁকা ----------
function renderMain() {
  const list = $('fileList');
  list.replaceChildren();

  const gq = $('globalSearch').value.trim();
  const course = courseOf(selectedCourseId);
  if (page === 'course' && !course) page = 'home';
  const inCourse = page === 'course';

  $('topbar').classList.toggle('hidden', !inCourse || !!viewing || !!gq);

  if (gq) return renderSearch(list, gq);
  if (page === 'planner') return renderPlanner(list);
  if (!inCourse) return renderHome(list);
  if (viewing) return renderViewer(list);
  renderCourse(list, course);
}

function render() {
  renderSidebar();
  renderMain();
}

// ---------- ফাইল যোগ করার বার ----------
function syncAddBar() {
  const isQ = $('typeSelect').value === 'Question';
  $('examSelect').classList.toggle('hidden', !isQ);
  $('yearInput').classList.toggle('hidden', !isQ);
}

function addMeta() {
  const type = $('typeSelect').value;
  const isQ = type === 'Question';
  return {
    type,
    exam: isQ ? $('examSelect').value : '',
    year: isQ ? $('yearInput').value.trim() : ''
  };
}

// ---------- ইভেন্ট ----------
$('courseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('courseName').value.trim();
  if (!name) return;

  await flushSave();
  const before = db.courses.length;
  db = await window.api.addCourse($('semesterSelect').value, name);
  if (db.courses.length > before) {
    page = 'course';
    selectedCourseId = db.courses[db.courses.length - 1].id;
    tab = 'all';
    viewing = null;
    selectMode = false;
    $('globalSearch').value = '';
  }
  $('courseName').value = '';
  render();
});

$('addFileBtn').addEventListener('click', async () => {
  if (!selectedCourseId) return;
  const before = db.files.length;
  db = await window.api.pickFiles(selectedCourseId, addMeta());
  const added = db.files.length - before;
  if (added > 0) showMessage(bn(added) + 'টি ফাইল যোগ হয়েছে');
  render();
});

$('addNoteBtn').addEventListener('click', async () => {
  if (!selectedCourseId) return;
  db = await window.api.addNote(selectedCourseId);
  const mine = db.notes.filter((n) => n.courseId === selectedCourseId);
  if (!mine.length) return;
  viewing = { kind: 'note', id: mine[mine.length - 1].id };
  render();
});

$('typeSelect').addEventListener('change', syncAddBar);
$('homeBtn').addEventListener('click', () => navigate('home'));
$('plannerBtn').addEventListener('click', () => navigate('planner'));
$('brandTitle').addEventListener('click', () => navigate('home'));
$('search').addEventListener('input', renderMain);
$('globalSearch').addEventListener('input', render);

$('exportBtn').addEventListener('click', async () => {
  await flushSave();
  const r = await window.api.exportBackup();
  if (r.ok) showMessage('ব্যাকআপ সেভ হয়েছে ✓');
  else if (r.error) showMessage('ব্যাকআপ হয়নি: ' + r.error);
});

$('importBtn').addEventListener('click', async () => {
  await flushSave();
  const r = await window.api.importBackup();
  if (r.ok) {
    db = r.db;
    render();
    showMessage(bn(r.added) + 'টি আইটেম ফিরিয়ে আনা হয়েছে ✓');
  } else if (r.error) {
    showMessage('রিস্টোর হয়নি: ' + r.error);
  }
});

// ---------- Drag & Drop ----------
const mainArea = document.querySelector('main');

['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault()));

mainArea.addEventListener('dragover', () => mainArea.classList.add('dragging'));
mainArea.addEventListener('dragleave', (e) => {
  if (!mainArea.contains(e.relatedTarget)) mainArea.classList.remove('dragging');
});
mainArea.addEventListener('drop', async (e) => {
  mainArea.classList.remove('dragging');
  if (page !== 'course' || !selectedCourseId) {
    showMessage('আগে একটা কোর্স বেছে নাও');
    return;
  }
  const paths = [...e.dataTransfer.files].map((f) => window.api.getPathForFile(f)).filter(Boolean);
  if (!paths.length) return;

  await flushSave();
  const before = db.files.length;
  db = await window.api.addPaths(selectedCourseId, addMeta(), paths);
  showMessage(bn(db.files.length - before) + 'টি ফাইল যোগ হয়েছে');
  render();
});

// ---------- ডার্ক/লাইট থিম ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('themeBtn').textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('theme', theme);
}

$('themeBtn').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

// ---------- স্প্ল্যাশ স্ক্রিন বন্ধ করা ----------
function hideSplash() {
  const splash = $('splash');
  setTimeout(() => {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 600);
  }, 1500);
}

// ---------- শুরু ----------
async function init() {
  SEMESTERS.forEach((s) => $('semesterSelect').append(new Option(s, s)));
  TYPES.forEach((t) => $('typeSelect').append(new Option(t, t)));
  EXAM_KINDS.forEach((t) => $('examSelect').append(new Option(t, t)));
  $('yearInput').value = new Date().getFullYear();

  const saved = localStorage.getItem('theme');
  applyTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  db = await window.api.getDB();
  render();
  hideSplash();
}

init();