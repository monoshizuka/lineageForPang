const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('./storage/database');
const { convertPdfToJson } = require('./storage/pdf-importer');

let storage;

/**
 * Resolve a database directory that can travel with a copied project.
 *
 * - LINEAGE_DATA_DIR can be used to explicitly choose a directory.
 * - In an unpackaged app (npm run dev/start), data lives in <project>/data.
 * - A packaged portable build can set PORTABLE_EXECUTABLE_DIR.
 * - Normal installed builds fall back to Electron's userData directory,
 *   because app.asar/application bundles are commonly read-only.
 */
function resolveDatabaseDirectory() {
  const configuredDirectory = process.env.LINEAGE_DATA_DIR?.trim();
  if (configuredDirectory) return path.resolve(configuredDirectory);

  if (!app.isPackaged) return path.join(app.getAppPath(), 'data');

  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR?.trim();
  if (portableDirectory) return path.join(path.resolve(portableDirectory), 'data');

  return app.getPath('userData');
}

function migrateLegacyDatabase(databaseDirectory) {
  if (databaseDirectory === app.getPath('userData')) return;

  const targetPath = path.join(databaseDirectory, 'lineage.sqlite3');
  const legacyPath = path.join(app.getPath('userData'), 'lineage.sqlite3');
  if (fs.existsSync(targetPath) || !fs.existsSync(legacyPath)) return;

  fs.mkdirSync(databaseDirectory, { recursive: true });
  fs.copyFileSync(legacyPath, targetPath);

  // Preserve SQLite's sidecar files when the previous process used WAL mode.
  for (const suffix of ['-wal', '-shm']) {
    const source = `${legacyPath}${suffix}`;
    const target = `${targetPath}${suffix}`;
    if (fs.existsSync(source)) fs.copyFileSync(source, target);
  }
}

function registerStorageHandlers() {
  ipcMain.handle('storage:get-path', () => resolveDatabaseDirectory());
  ipcMain.handle('lineage:list', () => storage.listLineages());
  ipcMain.handle('lineage:create', (_event, input) => storage.createLineage(input));
  ipcMain.handle('lineage:update', (_event, { id, changes } = {}) => storage.updateLineage(id, changes));
  ipcMain.handle('lineage:delete', (_event, id) => storage.deleteLineage(id));
  ipcMain.handle('lineage:import-pdf', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入世系 PDF',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF 世系表', extensions: ['pdf'] }]
    });
    if (result.canceled) return [];
    const outputDirectory = path.join(resolveDatabaseDirectory(), 'imports');
    const imported = [];
    for (const filePath of result.filePaths) {
      const converted = await convertPdfToJson(filePath, outputDirectory);
      imported.push({
        ...converted,
        ...storage.importJsonFile(converted.outputPath, { replace: true })
      });
    }
    return imported;
  });
  ipcMain.handle('person:list', (_event, options) => storage.listPersons(options));
  ipcMain.handle('person:get', (_event, id) => storage.getPerson(id));
  ipcMain.handle('person:create', (_event, input) => storage.createPerson(input));
  ipcMain.handle('person:create-above', (_event, input) => storage.createPersonAbove(input));
  ipcMain.handle('person:update', (_event, { id, changes } = {}) => storage.updatePerson(id, changes));
  ipcMain.handle('person:delete', (_event, id) => storage.deletePerson(id));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#f7f8fc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const allowedUrl = process.env.ELECTRON_RENDERER_URL;
    const isAllowed = allowedUrl ? url.startsWith(allowedUrl) : url.startsWith('file://');
    if (!isAllowed) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  const databaseDirectory = resolveDatabaseDirectory();
  migrateLegacyDatabase(databaseDirectory);
  storage = createDatabase(path.join(databaseDirectory, 'lineage.sqlite3'));
  storage.importDirectory(path.join(__dirname, 'data'));
  registerStorageHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  storage?.close();
  storage = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
