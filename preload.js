const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getDB: () => ipcRenderer.invoke('db:get'),

  addCourse: (semester, name) => ipcRenderer.invoke('course:add', semester, name),
  updateCourse: (id, patch) => ipcRenderer.invoke('course:update', id, patch),
  deleteCourse: (id) => ipcRenderer.invoke('course:delete', id),

  pickFiles: (courseId, meta) => ipcRenderer.invoke('file:pick', courseId, meta),
  addPaths: (courseId, meta, paths) => ipcRenderer.invoke('file:addPaths', courseId, meta, paths),
  openFile: (id) => ipcRenderer.invoke('file:open', id),
  getFileUrl: (id) => ipcRenderer.invoke('file:url', id),
  getFileData: (id) => ipcRenderer.invoke('file:data', id),
  getFileText: (id) => ipcRenderer.invoke('file:text', id),
  saveFileAs: (id) => ipcRenderer.invoke('file:saveAs', id),
  updateFile: (id, patch) => ipcRenderer.invoke('file:update', id, patch),
  deleteFile: (id) => ipcRenderer.invoke('file:delete', id),
  toggleFavorite: (id) => ipcRenderer.invoke('file:favorite', id),
  touch: (kind, id) => ipcRenderer.invoke('item:touch', kind, id),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  setTags: (kind, id, tags) => ipcRenderer.invoke('tags:set', kind, id, tags),

  addNote: (courseId) => ipcRenderer.invoke('note:add', courseId),
  updateNote: (id, title, content) => ipcRenderer.invoke('note:update', id, title, content),
  deleteNote: (id) => ipcRenderer.invoke('note:delete', id),

  listAdd: (kind, courseId, data) => ipcRenderer.invoke('list:add', kind, courseId, data),
  listUpdate: (kind, id, patch) => ipcRenderer.invoke('list:update', kind, id, patch),
  listDelete: (kind, id) => ipcRenderer.invoke('list:delete', kind, id),

  mergePdfs: (courseId, ids, name) => ipcRenderer.invoke('pdf:merge', courseId, ids, name),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  openMail: (email) => ipcRenderer.invoke('mail:open', email)
});