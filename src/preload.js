const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node
  },
  storage: {
    getPath: () => ipcRenderer.invoke('storage:get-path'),
    listLineages: () => ipcRenderer.invoke('lineage:list'),
    createLineage: (input) => ipcRenderer.invoke('lineage:create', input),
    updateLineage: (id, changes) => ipcRenderer.invoke('lineage:update', { id, changes }),
    deleteLineage: (id) => ipcRenderer.invoke('lineage:delete', id),
    importPdfs: () => ipcRenderer.invoke('lineage:import-pdf'),
    listPersons: (options) => ipcRenderer.invoke('person:list', options),
    getPerson: (id) => ipcRenderer.invoke('person:get', id),
    createPerson: (input) => ipcRenderer.invoke('person:create', input),
    createPersonAbove: (input) => ipcRenderer.invoke('person:create-above', input),
    updatePerson: (id, changes) => ipcRenderer.invoke('person:update', { id, changes }),
    deletePerson: (id) => ipcRenderer.invoke('person:delete', id)
  }
});
