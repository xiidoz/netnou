// What has to be settled before anything of the page is drawn: its colour
// scheme, and whether the header card shows right away.
//
// Not a module like the other scripts: index.html loads this one first and
// waits for it. The others are large and arrive later; the page as the server
// sent it is drawn before they have run.

// The colour scheme of the page: light or dark as the visitor chose it in the
// settings, or else as the device has it. style.css follows the attribute set
// here and knows nothing of the device. app.js calls this again when the
// visitor chooses or the device changes.
window.applyColorScheme = () => {
  let choice = null;
  // (while the page is a display its address says it, in place of what is stored: see "display mode" in app.js)
  const address = new URLSearchParams(location.search);
  if (address.has('display')) choice = address.get('theme');
  else {
    try {
      choice = JSON.parse(localStorage.getItem('netnou.theme'));
    } catch {
      // private mode, blocked storage, or not what the page stored: as the device has it
    }
  }
  const dark = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
};
window.applyColorScheme();

// The header card. The server sends it as most visitors get it: in the
// language their browser asks for, every mode of transport switched on, the
// vehicles coloured by their mode (server/lib/page.js). Where that is what
// this visitor gets, the card shows with the first paint, well before app.js
// has arrived. Where it is not – another language chosen in the settings, a
// display, modes switched off, colours by delay – it stays out of sight until
// app.js has made it so: a card that changes under the eyes of who reads it
// is worse than one that comes later.
//
// The language is picked as pickLanguage in i18n.js picks it, and the settings
// are read as app.js reads them; test/frontend.test.js holds the two together.
{
  const root = document.documentElement;
  const address = new URLSearchParams(location.search);
  const stored = (key) => {
    try {
      return localStorage.getItem(`netnou.${key}`);
    } catch {
      return null; // private mode or blocked storage
    }
  };
  const setting = (key) => {
    try {
      return JSON.parse(stored(key));
    } catch {
      return null; // not what the page stored
    }
  };

  // (which languages there are, the server says: it wrote the page in one of them)
  const languages = (root.dataset.languages ?? '').split(' ');
  const preferred = (navigator.languages ?? []).map((tag) => tag.toLowerCase().split('-')[0]);
  const language = [stored('lang'), address.get('lang'), ...preferred].find((code) => languages.includes(code)) ?? 'en';
  const hiddenModes = setting('hiddenModes');
  const asSent = language === root.lang && !address.has('display') && setting('colorBy') !== 'delay' && !(Array.isArray(hiddenModes) && hiddenModes.length);
  if (asSent) root.dataset.controls = 'shown';
  // Chips that fold on a wide screen (style.css) are open where the visitor opened them.
  if (setting('chipsOpen') === true) root.dataset.chipsOpen = '';
}
