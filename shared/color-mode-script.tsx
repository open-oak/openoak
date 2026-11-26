// Applies the saved light/dark mode before the first paint, so an app does not
// render in light mode and then switch to dark after hydration. The app stores
// "auto", "light" or "dark" under `storageKey`; anything else counts as "auto".
export function ColorModeScript({ storageKey, nonce }: { storageKey: string; nonce?: string }) {
  const script = `(function(){try{
    var mode = localStorage.getItem(${JSON.stringify(storageKey)});
    var dark = mode === 'dark' || (mode !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.add(dark ? 'dark' : 'light');
  }catch(e){}})();`;
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />;
}
