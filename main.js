const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const AdmZip = require('adm-zip');
const { PDFDocument } = require('pdf-lib');

// ডেটা রাখার জায়গা (আপডেট দিলেও হারাবে না)
const userData = app.getPath('userData');
const filesDir = path.join(userData, 'files');
const dbPath = path.join(userData, 'data.json');
fs.mkdirSync(filesDir, { recursive: true });

const SEMESTERS = ['Semester 1', 'Semester 2', 'Semester 3', 'Semester 4', 'Semester 5', 'Semester 6', 'Semester 7', 'Semester 8'];
const TYPES = ['Note', 'PDF', 'Question', 'Lab Report', 'Other'];
const EXAM_KINDS = ['Mid', 'Final', 'Class Test', 'Quiz', 'Assignment', 'Other'];
const KEYS = ['courses', 'files', 'notes', 'exams', 'routine', 'chapters'];

// ---------- ছোট সাহায্যকারী ফাংশন ----------
const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadDB() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  } catch {
    raw = {};
  }
  const db = {};
  KEYS.forEach((k) => (db[k] = Array.isArray(raw[k]) ? raw[k] : []));
  return db;
}

function saveDB(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function removeStored(storedName) {
  try {
    fs.unlinkSync(path.join(filesDir, storedName));
  } catch {
    // ফাইল আগেই মুছে গেছে, সমস্যা নেই
  }
}

function cleanTags(tags) {
  const out = [];
  for (const t of Array.isArray(tags) ? tags : []) {
    const s = String(t).trim().replace(/^#+/, '').slice(0, 24);
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 20);
}

function storedPath(id) {
  const f = loadDB().files.find((x) => x.id === id);
  if (!f) return null;
  const p = path.join(filesDir, f.storedName);
  return fs.existsSync(p) ? p : null;
}

function daysLeft(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}

// ---------- রুটিন, পরীক্ষা, চ্যাপ্টারের ফিল্ড-নিয়ম ----------
const SAN = {
  s: (v) => str(v, 120),
  date: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : ''),
  time: (v) => (/^\d{2}:\d{2}$/.test(String(v)) ? String(v) : ''),
  day: (v) => {
    const n = Number(v);
    return n >= 0 && n <= 6 ? Math.floor(n) : 0;
  },
  bool: (v) => !!v
};

const LISTS = {
  exams: { title: SAN.s, date: SAN.date, time: SAN.time, room: SAN.s },
  routine: { day: SAN.day, start: SAN.time, end: SAN.time, room: SAN.s },
  chapters: { title: SAN.s, done: SAN.bool }
};

function pick(kind, src, all = false) {
  const out = {};
  for (const [k, fn] of Object.entries(LISTS[kind])) {
    if (all || k in src) out[k] = fn(src[k]);
  }
  return out;
}

const COURSE_FIELDS = {
  name: (v) => str(v, 80),
  semester: (v) => (SEMESTERS.includes(v) ? v : null),
  teacher: (v) => str(v, 80),
  email: (v) => str(v, 100),
  credit: (v) => str(v, 10),
  room: (v) => str(v, 60)
};

// ---------- ফাইল কপি করে অ্যাপের ফোল্ডারে রাখা ----------
function addPaths(courseId, meta, paths) {
  const db = loadDB();
  if (!db.courses.some((c) => c.id === courseId)) return db;

  const type = TYPES.includes(meta && meta.type) ? meta.type : 'Other';
  const isQ = type === 'Question';
  const exam = isQ ? (EXAM_KINDS.includes(meta.exam) ? meta.exam : 'Other') : '';
  const year = isQ && /^\d{4}$/.test(String(meta.year || '')) ? String(meta.year) : '';

  for (const p of paths) {
    try {
      if (!fs.statSync(p).isFile()) continue;
      const storedName = newId() + path.extname(p);
      fs.copyFileSync(p, path.join(filesDir, storedName));
      db.files.push({
        id: newId(),
        courseId,
        type,
        exam,
        year,
        name: path.basename(p),
        storedName,
        addedAt: Date.now(),
        favorite: false,
        tags: []
      });
    } catch (err) {
      console.error('কপি করা যায়নি:', p, err.message);
    }
  }
  saveDB(db);
  return db;
}

// ---------- কোর্স ----------
ipcMain.handle('db:get', () => loadDB());

ipcMain.handle('course:add', (e, semester, name) => {
  const db = loadDB();
  name = str(name, 80);
  if (name && SEMESTERS.includes(semester)) {
    db.courses.push({ id: newId(), semester, name, teacher: '', email: '', credit: '', room: '' });
    saveDB(db);
  }
  return db;
});

ipcMain.handle('course:update', (e, id, patch) => {
  const db = loadDB();
  const c = db.courses.find((x) => x.id === id);
  if (c && patch) {
    for (const [k, fn] of Object.entries(COURSE_FIELDS)) {
      if (!(k in patch)) continue;
      const v = fn(patch[k]);
      if (v === null || (k === 'name' && !v)) continue;
      c[k] = v;
    }
    saveDB(db);
  }
  return db;
});

ipcMain.handle('course:delete', (e, id) => {
  const db = loadDB();
  db.files.filter((f) => f.courseId === id).forEach((f) => removeStored(f.storedName));
  KEYS.filter((k) => k !== 'courses').forEach((k) => {
    db[k] = db[k].filter((x) => x.courseId !== id);
  });
  db.courses = db.courses.filter((c) => c.id !== id);
  saveDB(db);
  return db;
});

// ---------- ফাইল ----------
ipcMain.handle('file:pick', async (e, courseId, meta) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'ফাইল বাছাই করো',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'gif', 'webp'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled) return loadDB();
  return addPaths(courseId, meta, result.filePaths);
});

ipcMain.handle('file:addPaths', (e, courseId, meta, paths) => addPaths(courseId, meta, paths));

ipcMain.handle('file:open', async (e, id) => {
  const p = storedPath(id);
  if (!p) return 'ফাইল পাওয়া যায়নি';
  return shell.openPath(p); // সফল হলে খালি লেখা ফেরত দেয়
});

ipcMain.handle('file:url', (e, id) => {
  const p = storedPath(id);
  return p ? pathToFileURL(p).href : null;
});

// pdf.js-এর জন্য ফাইলের আসল বাইট
ipcMain.handle('file:data', (e, id) => {
  const p = storedPath(id);
  if (!p) return null;
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
});

ipcMain.handle('file:text', (e, id) => {
  const p = storedPath(id);
  if (!p) return null;
  try {
    return fs.readFileSync(p).subarray(0, 500000).toString('utf-8');
  } catch {
    return null;
  }
});

ipcMain.handle('file:saveAs', async (e, id) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const f = loadDB().files.find((x) => x.id === id);
  const p = storedPath(id);
  if (!f || !p) return false;
  const r = await dialog.showSaveDialog(win, { title: 'ফাইল সেভ করো', defaultPath: f.name });
  if (r.canceled || !r.filePath) return false;
  try {
    fs.copyFileSync(p, r.filePath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('file:update', (e, id, patch) => {
  const db = loadDB();
  const f = db.files.find((x) => x.id === id);
  if (f && patch) {
    if (TYPES.includes(patch.type)) f.type = patch.type;
    if (f.type === 'Question') {
      if (EXAM_KINDS.includes(patch.exam)) f.exam = patch.exam;
      else if (!f.exam) f.exam = 'Other';
      f.year = /^\d{4}$/.test(String(patch.year || '')) ? String(patch.year) : '';
    } else {
      f.exam = '';
      f.year = '';
    }
    saveDB(db);
  }
  return db;
});

ipcMain.handle('file:delete', (e, id) => {
  const db = loadDB();
  const f = db.files.find((x) => x.id === id);
  if (f) removeStored(f.storedName);
  db.files = db.files.filter((x) => x.id !== id);
  saveDB(db);
  return db;
});

ipcMain.handle('file:favorite', (e, id) => {
  const db = loadDB();
  const f = db.files.find((x) => x.id === id);
  if (f) f.favorite = !f.favorite;
  saveDB(db);
  return db;
});

// সর্বশেষ কখন খোলা হয়েছে (হোমের "সাম্প্রতিক" অংশের জন্য)
ipcMain.handle('item:touch', (e, kind, id) => {
  const db = loadDB();
  const item = (kind === 'note' ? db.notes : db.files).find((x) => x.id === id);
  if (item) {
    item.lastOpenedAt = Date.now();
    saveDB(db);
  }
  return true;
});

// ---------- ট্যাগ ----------
ipcMain.handle('tags:set', (e, kind, id, tags) => {
  const db = loadDB();
  const item = (kind === 'note' ? db.notes : db.files).find((x) => x.id === id);
  if (item) item.tags = cleanTags(tags);
  saveDB(db);
  return db;
});

// ---------- নোট ----------
ipcMain.handle('note:add', (e, courseId) => {
  const db = loadDB();
  if (db.courses.some((c) => c.id === courseId)) {
    const now = Date.now();
    db.notes.push({ id: newId(), courseId, title: 'নতুন নোট', content: '', tags: [], addedAt: now, updatedAt: now });
  }
  saveDB(db);
  return db;
});

ipcMain.handle('note:update', (e, id, title, content) => {
  const db = loadDB();
  const n = db.notes.find((x) => x.id === id);
  if (n) {
    n.title = String(title || '').trim().slice(0, 200) || 'নামহীন নোট';
    n.content = String(content || '');
    n.updatedAt = Date.now();
    saveDB(db);
  }
  return true;
});

ipcMain.handle('note:delete', (e, id) => {
  const db = loadDB();
  db.notes = db.notes.filter((n) => n.id !== id);
  saveDB(db);
  return db;
});

// ---------- পরীক্ষা / রুটিন / চ্যাপ্টার ----------
ipcMain.handle('list:add', (e, kind, courseId, data) => {
  const db = loadDB();
  if (!Object.hasOwn(LISTS, kind) || !db.courses.some((c) => c.id === courseId)) return db;
  const item = { id: newId(), courseId, ...pick(kind, data || {}, true) };
  const ok = kind === 'exams' ? item.title && item.date : kind === 'routine' ? item.start : item.title;
  if (ok) {
    item.addedAt = Date.now();
    db[kind].push(item);
    saveDB(db);
  }
  return db;
});

ipcMain.handle('list:update', (e, kind, id, patch) => {
  const db = loadDB();
  if (!Object.hasOwn(LISTS, kind)) return db;
  const item = db[kind].find((x) => x.id === id);
  if (item) {
    Object.assign(item, pick(kind, patch || {}));
    if (kind === 'exams') delete item.notifiedFor;
    saveDB(db);
  }
  return db;
});

ipcMain.handle('list:delete', (e, kind, id) => {
  const db = loadDB();
  if (!Object.hasOwn(LISTS, kind)) return db;
  db[kind] = db[kind].filter((x) => x.id !== id);
  saveDB(db);
  return db;
});

// ---------- PDF মার্জ ----------
ipcMain.handle('pdf:merge', async (e, courseId, ids, outName) => {
  const db = loadDB();
  if (!db.courses.some((c) => c.id === courseId)) return { db, error: 'কোর্স পাওয়া যায়নি' };

  const picked = (Array.isArray(ids) ? ids : [])
    .map((id) => db.files.find((f) => f.id === id && f.courseId === courseId && path.extname(f.name).toLowerCase() === '.pdf'))
    .filter(Boolean);
  if (picked.length < 2) return { db, error: 'কমপক্ষে ২টা PDF বাছো' };

  try {
    const out = await PDFDocument.create();
    for (const f of picked) {
      const bytes = fs.readFileSync(path.join(filesDir, f.storedName));
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    const bytes = await out.save();
    const storedName = newId() + '.pdf';
    fs.writeFileSync(path.join(filesDir, storedName), bytes);

    let name = str(outName, 80).replace(/[\\/:*?"<>|]/g, '') || 'Merged ' + new Date().toISOString().slice(0, 10);
    if (!/\.pdf$/i.test(name)) name += '.pdf';

    db.files.push({
      id: newId(),
      courseId,
      type: 'PDF',
      exam: '',
      year: '',
      name,
      storedName,
      addedAt: Date.now(),
      favorite: false,
      tags: []
    });
    saveDB(db);
    return { db };
  } catch (err) {
    return { db: loadDB(), error: 'মার্জ করা যায়নি: ' + err.message };
  }
});

// ---------- ব্যাকআপ / রিস্টোর ----------
ipcMain.handle('backup:export', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, {
    title: 'ব্যাকআপ সেভ করো (চাইলে Google Drive ফোল্ডার বেছে নাও)',
    defaultPath: 'CampusNotes-backup-' + new Date().toISOString().slice(0, 10) + '.zip',
    filters: [{ name: 'Zip', extensions: ['zip'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false };
  try {
    const zip = new AdmZip();
    zip.addFile('data.json', Buffer.from(JSON.stringify(loadDB(), null, 2)));
    zip.addLocalFolder(filesDir, 'files');
    zip.writeZip(r.filePath);
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// রিস্টোর = বর্তমান ডেটার সাথে জোড়া লাগে, কিছু মোছে না
ipcMain.handle('backup:import', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: 'ব্যাকআপ ফাইল বাছাই করো',
    properties: ['openFile'],
    filters: [{ name: 'Zip', extensions: ['zip'] }]
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  try {
    const zip = new AdmZip(r.filePaths[0]);
    const entry = zip.getEntry('data.json');
    if (!entry) return { ok: false, error: 'এটা CampusNotes-এর ব্যাকআপ ফাইল নয়' };
    const incoming = JSON.parse(entry.getData().toString('utf-8'));

    const db = loadDB();
    let added = 0;
    for (const key of KEYS) {
      for (const item of Array.isArray(incoming[key]) ? incoming[key] : []) {
        if (!item || typeof item.id !== 'string' || db[key].some((x) => x.id === item.id)) continue;
        if (key === 'files') item.storedName = path.basename(String(item.storedName || ''));
        db[key].push(item);
        added++;
      }
    }
    for (const en of zip.getEntries()) {
      if (en.isDirectory || !en.entryName.startsWith('files/')) continue;
      const target = path.join(filesDir, path.basename(en.entryName));
      if (!fs.existsSync(target)) fs.writeFileSync(target, en.getData());
    }
    saveDB(db);
    return { ok: true, db, added };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------- শিক্ষককে ইমেইল ----------
ipcMain.handle('mail:open', (e, email) => {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    shell.openExternal('mailto:' + email);
    return true;
  }
  return false;
});

// ---------- পরীক্ষার রিমাইন্ডার ----------
function checkExamReminders() {
  if (!Notification.isSupported()) return;
  const db = loadDB();
  let changed = false;
  for (const ex of db.exams) {
    if (!ex.date) continue;
    const d = daysLeft(ex.date);
    if (![0, 1, 3, 7].includes(d) || ex.notifiedFor === d) continue;
    const course = db.courses.find((c) => c.id === ex.courseId);
    new Notification({
      title: '📅 পরীক্ষা আসছে!',
      body: (course ? course.name + ' — ' : '') + ex.title + ': ' + (d === 0 ? 'আজ!' : d + ' দিন বাকি')
    }).show();
    ex.notifiedFor = d;
    changed = true;
  }
  if (changed) saveDB(db);
}

// ---------- উইন্ডো ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 520,
    title: 'CampusNotes',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.campusnotes.app');
  createWindow();
  checkExamReminders();
  setInterval(checkExamReminders, 60 * 60 * 1000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});