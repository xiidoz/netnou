// The colour scheme of the page: light or dark as the visitor chose it in the
// settings, or else as the device has it. style.css follows the attribute set
// here and knows nothing of the device.
//
// Not a module like the other scripts: index.html loads this one first and
// waits for it, so that the page is in its scheme before anything of it is
// drawn. app.js calls it again when the visitor chooses or the device changes.

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
