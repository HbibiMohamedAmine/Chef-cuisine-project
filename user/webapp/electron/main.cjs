/**
 * Processus principal Electron — empaquetage Windows.
 *
 * Principe : on réutilise INTÉGRALEMENT le serveur Express existant.
 * Aucune réécriture applicative n'est nécessaire.
 *
 *  1. La base SQLite est placée dans %APPDATA%/chef-cuisine-manager/
 *     (le dossier d'installation est en lecture seule sous Windows).
 *  2. Le serveur est lancé en local sur un port libre (127.0.0.1 uniquement).
 *  3. Une BrowserWindow affiche l'application.
 */
const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');

// --- Chemins de données ------------------------------------------------------
const USER_DATA = app.getPath('userData');
const DB_DIR = path.join(USER_DATA, 'donnees');
const BACKUP_DIR = path.join(USER_DATA, 'sauvegardes');
fs.mkdirSync(DB_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

process.env.CCM_DB_PATH = path.join(DB_DIR, 'chef-cuisine.db');
process.env.CCM_BACKUP_DIR = BACKUP_DIR;
process.env.NODE_ENV = 'production';

let mainWindow = null;
let serverInstance = null;

/** Trouve un port TCP libre sur la boucle locale. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Démarre le serveur Express embarqué. */
async function startServer() {
  const port = await findFreePort();
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';

  // Le serveur est un module ESM : on l'importe dynamiquement.
  await import(path.join(__dirname, '..', 'server', 'index.js'));
  return `http://127.0.0.1:${port}`;
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Chef Cuisine Manager',
    backgroundColor: '#f8fafc',
    show: false,
    webPreferences: {
      // Aucun accès Node.js dans le rendu : l'application est servie par HTTP local.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(url);

  // Les liens externes s'ouvrent dans le navigateur par défaut, jamais dans l'app.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(url)) shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Menu minimal français (pas de menu développeur en production). */
function buildMenu() {
  const template = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Dossier des données',
          click: () => shell.openPath(DB_DIR),
        },
        {
          label: 'Dossier des sauvegardes',
          click: () => shell.openPath(BACKUP_DIR),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter' },
      ],
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Actualiser' },
        { role: 'resetZoom', label: 'Taille normale' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'À propos',
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Chef Cuisine Manager',
              message: 'Chef Cuisine Manager',
              detail:
                'Gestion intégrée de restaurant — dinar tunisien.\n\n' +
                'Données locales : ' + DB_DIR + '\n\n' +
                'Ce logiciel n’est pas un logiciel comptable certifié. ' +
                'Les paramètres comptables doivent être validés par votre comptable.',
              buttons: ['Fermer'],
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- Cycle de vie -----------------------------------------------------------
app.whenReady().then(async () => {
  try {
    const url = await startServer();
    buildMenu();
    createWindow(url);
  } catch (err) {
    dialog.showErrorBox(
      'Démarrage impossible',
      `Le serveur local n’a pas pu démarrer.\n\n${err.message}`,
    );
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverInstance) {
      createWindow(`http://127.0.0.1:${process.env.PORT}`);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Arrêt propre : laisse le serveur fermer la base (WAL synchronisé).
app.on('before-quit', () => {
  serverInstance = null;
});
