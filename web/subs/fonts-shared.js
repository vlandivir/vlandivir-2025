/**
 * Shared font catalog and IndexedDB prefs for /subs and /font.
 * Loaded via <script src="fonts-shared.js"> before page scripts.
 */
(function initSubsFonts(global) {
  const DB_NAME = 'subs-project';
  const DB_VERSION = 4;
  const VIDEO_STORE = 'videos';
  const STYLE_STORE = 'styles';
  const CUE_STORE = 'cues';
  const POSITION_STORE = 'positions';
  const FONT_PREFS_STORE = 'fontPrefs';
  const FONT_PREFS_ID = 'enabled';

  /** Shown in the style editor until the user picks more on /font */
  const DEFAULT_ENABLED_FAMILIES = [
    'Montserrat',
    'Bebas Neue Cyrillic',
    'Inter',
    'Roboto',
    'Oswald',
    'Golos Text',
  ];

  const SUBTITLE_FONTS = [
    { family: 'Alegreya Sans', regular: 'alegreya-sans-400.ttf', bold: 'alegreya-sans-700.ttf' },
    { family: 'Arsenal', regular: 'arsenal-400.ttf', bold: 'arsenal-700.ttf' },
    { family: 'Bebas Neue Cyrillic', regular: 'bebas-neue-cyrillic-400.ttf', bold: 'bebas-neue-cyrillic-400.ttf' },
    { family: 'Bitter', regular: 'bitter-400.ttf', bold: 'bitter-700.ttf' },
    { family: 'Comfortaa', regular: 'comfortaa-400.ttf', bold: 'comfortaa-700.ttf' },
    { family: 'Commissioner', regular: 'commissioner-400.ttf', bold: 'commissioner-700.ttf' },
    { family: 'Cormorant Garamond', regular: 'cormorant-garamond-400.ttf', bold: 'cormorant-garamond-700.ttf' },
    { family: 'EB Garamond', regular: 'eb-garamond-400.ttf', bold: 'eb-garamond-700.ttf' },
    { family: 'Exo 2', regular: 'exo-2-400.ttf', bold: 'exo-2-700.ttf' },
    { family: 'Finlandica', regular: 'finlandica-400.ttf', bold: 'finlandica-700.ttf' },
    { family: 'Fira Sans', regular: 'fira-sans-400.ttf', bold: 'fira-sans-700.ttf' },
    { family: 'Geologica', regular: 'geologica-400.ttf', bold: 'geologica-700.ttf' },
    { family: 'Golos Text', regular: 'golos-text-400.ttf', bold: 'golos-text-700.ttf' },
    { family: 'IBM Plex Sans', regular: 'ibm-plex-sans-400.ttf', bold: 'ibm-plex-sans-700.ttf' },
    { family: 'IBM Plex Serif', regular: 'ibm-plex-serif-400.ttf', bold: 'ibm-plex-serif-700.ttf' },
    { family: 'Inter', regular: 'inter-400.ttf', bold: 'inter-700.ttf' },
    { family: 'Jost', regular: 'jost-400.ttf', bold: 'jost-700.ttf' },
    { family: 'Lack', regular: 'lack-400.otf', bold: 'lack-700.otf' },
    { family: 'Literata', regular: 'literata-400.ttf', bold: 'literata-700.ttf' },
    { family: 'Manrope', regular: 'manrope-400.ttf', bold: 'manrope-700.ttf' },
    { family: 'Merriweather', regular: 'merriweather-400.ttf', bold: 'merriweather-700.ttf' },
    { family: 'Montserrat', regular: 'montserrat-400.ttf', bold: 'montserrat-700.ttf' },
    { family: 'Noto Sans', regular: 'noto-sans-400.ttf', bold: 'noto-sans-700.ttf' },
    { family: 'Nunito Sans', regular: 'nunito-sans-400.ttf', bold: 'nunito-sans-700.ttf' },
    { family: 'Oi', regular: 'oi-400.ttf', bold: 'oi-400.ttf' },
    { family: 'Onest', regular: 'onest-400.ttf', bold: 'onest-700.ttf' },
    { family: 'Open Sans', regular: 'open-sans-400.ttf', bold: 'open-sans-700.ttf' },
    { family: 'Oswald', regular: 'oswald-400.ttf', bold: 'oswald-700.ttf' },
    { family: 'Playfair Display', regular: 'playfair-display-400.ttf', bold: 'playfair-display-700.ttf' },
    { family: 'PT Sans', regular: 'pt-sans-400.ttf', bold: 'pt-sans-700.ttf' },
    { family: 'PT Serif', regular: 'pt-serif-400.ttf', bold: 'pt-serif-700.ttf' },
    { family: 'Roboto', regular: 'roboto-400.ttf', bold: 'roboto-700.ttf' },
    { family: 'Roboto Condensed', regular: 'roboto-condensed-400.ttf', bold: 'roboto-condensed-700.ttf' },
    { family: 'Roboto Slab', regular: 'roboto-slab-400.ttf', bold: 'roboto-slab-700.ttf' },
    { family: 'Rubik', regular: 'rubik-400.ttf', bold: 'rubik-700.ttf' },
    { family: 'Russo One', regular: 'russo-one-400.ttf', bold: 'russo-one-400.ttf' },
    { family: 'Spectral', regular: 'spectral-400.ttf', bold: 'spectral-700.ttf' },
    { family: 'Source Sans 3', regular: 'source-sans-3-400.ttf', bold: 'source-sans-3-700.ttf' },
    { family: 'Tektur', regular: 'tektur-400.ttf', bold: 'tektur-700.ttf' },
    { family: 'Ubuntu', regular: 'ubuntu-400.ttf', bold: 'ubuntu-700.ttf' },
    { family: 'Unbounded', regular: 'unbounded-400.ttf', bold: 'unbounded-700.ttf' },
  ];

  const FAMILY_TO_FONT = new Map(SUBTITLE_FONTS.map((font) => [font.family, font]));
  const VALID_FAMILIES = new Set(FAMILY_TO_FONT.keys());

  let dbPromise;

  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(VIDEO_STORE)) {
          const store = db.createObjectStore(VIDEO_STORE, { keyPath: 'hash' });
          store.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(STYLE_STORE)) {
          const store = db.createObjectStore(STYLE_STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(CUE_STORE)) {
          const store = db.createObjectStore(CUE_STORE, { keyPath: 'id' });
          store.createIndex('start', 'start');
          store.createIndex('styleId', 'styleId');
        }
        if (!db.objectStoreNames.contains(POSITION_STORE)) {
          const store = db.createObjectStore(POSITION_STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(FONT_PREFS_STORE)) {
          db.createObjectStore(FONT_PREFS_STORE, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return dbPromise;
  }

  function sanitizeFamilies(families) {
    if (!Array.isArray(families)) return [];
    const seen = new Set();
    const result = [];
    for (const name of families) {
      if (typeof name !== 'string') continue;
      const trimmed = name.trim();
      if (!VALID_FAMILIES.has(trimmed) || seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
    }
    return result;
  }

  async function readEnabledFontFamilies() {
    const db = await openDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(FONT_PREFS_STORE, 'readonly');
      const request = transaction.objectStore(FONT_PREFS_STORE).get(FONT_PREFS_ID);

      request.onsuccess = () => {
        const stored = sanitizeFamilies(request.result?.families);
        resolve(stored.length > 0 ? stored : [...DEFAULT_ENABLED_FAMILIES]);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function writeEnabledFontFamilies(families) {
    const db = await openDb();
    const record = {
      id: FONT_PREFS_ID,
      families: sanitizeFamilies(families),
      updatedAt: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(FONT_PREFS_STORE, 'readwrite');
      transaction.objectStore(FONT_PREFS_STORE).put(record);
      transaction.oncomplete = () => resolve(record.families);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function getFontsForFamilies(familyNames) {
    const names = sanitizeFamilies(familyNames);
    return names
      .map((family) => FAMILY_TO_FONT.get(family))
      .filter(Boolean);
  }

  global.SubsFonts = {
    DB_NAME,
    DB_VERSION,
    VIDEO_STORE,
    STYLE_STORE,
    CUE_STORE,
    POSITION_STORE,
    FONT_PREFS_STORE,
    FONT_PREFS_ID,
    SUBTITLE_FONTS,
    DEFAULT_ENABLED_FAMILIES,
    VALID_FAMILIES,
    FAMILY_TO_FONT,
    openDb,
    readEnabledFontFamilies,
    writeEnabledFontFamilies,
    getFontsForFamilies,
    sanitizeFamilies,
  };
})(window);
