(() => {
  'use strict';

  const { source, ready } = document.currentScript.dataset;
  const surface = document.querySelector('main');
  for (const link of document.querySelectorAll('[data-ranking-share]')) {
    const url = new URL(link.href);
    const page = new URL(location.href);
    page.hash = link.dataset.rankingShare;
    url.searchParams.set('url', page.href);
    link.href = url.href;
  }
  let savedTenureFocus;
  if (location.pathname.startsWith('/rankings/tenure_norms/')) {
    try { savedTenureFocus = JSON.parse(localStorage.getItem('tenure-selection:shared'))?.focus; } catch {}
  }
  const pending = [];
  let loading;
  const controls = 'button, select, input, textarea, [role="button"]';

  function identify(element) {
    if (element.id) return { selector: '#' + CSS.escape(element.id), index: 0 };
    let selector = element.localName;
    for (const name of element.getAttributeNames()) {
      if (name.startsWith('data-') || ['aria-label', 'name', 'title'].includes(name)) {
        selector += '[' + CSS.escape(name) + '="' + CSS.escape(element.getAttribute(name)) + '"]';
      }
    }
    const matches = [...surface.querySelectorAll(selector)];
    return { selector, index: matches.indexOf(element) };
  }

  function waitForResults() {
    if (document.querySelector(ready)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (document.querySelector(ready)) {
          clearTimeout(timeout);
          observer.disconnect();
          resolve();
        }
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error('Interactive results did not load.'));
      }, 30000);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    });
  }

  async function runScript(original, parent) {
    const script = document.createElement('script');
    for (const attribute of original.attributes) script.setAttribute(attribute.name, attribute.value);
    script.textContent = original.textContent;
    if (!script.src || (script.type && script.type !== 'text/javascript' && script.type !== 'module')) {
      parent.append(script);
      return;
    }
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load ' + script.src));
      parent.append(script);
    });
  }

  async function activate() {
    surface.setAttribute('aria-busy', 'true');
    let interactive;
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error('Could not load interactive rankings.');
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (!doc.querySelector('main')) throw new Error('Interactive rankings are missing.');
      const tenure = doc.querySelector('#finance-tenure-peers, #atlas-field-rankings');
      const displayedSchool = surface.querySelector('#finance-tenure-peers [data-school], #atlas-school:not([hidden])')?.defaultValue;
      if (tenure && displayedSchool && pending.length && !savedTenureFocus) tenure.dataset.snapshotSchool = displayedSchool;
      const scripts = [...doc.querySelectorAll('script')];
      scripts.forEach(script => script.remove());
      // Deferred head scripts originally run after inline body scripts.
      const ordered = [
        ...scripts.filter(script => !script.hasAttribute('defer')),
        ...scripts.filter(script => script.hasAttribute('defer')),
      ];
      const scrollTop = window.scrollY;
      document.body.replaceChildren(...doc.body.childNodes);
      interactive = document.querySelector('main');
      interactive.setAttribute('aria-busy', 'true');
      // Head scripts can depend on JSON script elements in the body.
      const isData = script => script.type === 'application/json';
      for (const script of ordered.filter(isData)) await runScript(script, document.body);
      for (const script of ordered.filter(script => !isData(script))) await runScript(script, document.body);
      await waitForResults();
      window.scrollTo(0, scrollTop);
      for (const { selector, index, type, value, checked, key, focused } of pending) {
        const target = document.querySelector('main')?.querySelectorAll(selector)[index];
        if (!target) continue;
        if (value !== undefined) target.value = value;
        if (checked !== undefined) target.checked = checked;
        if (focused) target.focus?.({ preventScroll: true });
        if (type === 'click') {
          if (target.click) target.click();
          else target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        } else if (type === 'keydown') {
          target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
          if (key === 'Enter' && target.form && target.type !== 'number') target.form.requestSubmit();
        } else {
          target.dispatchEvent(new Event(type, { bubbles: true }));
        }
      }
    } catch (error) {
      if (interactive) {
        // Return to the cached page with a fresh runtime after a partial mount.
        sessionStorage.setItem('ranking-load-failed', location.pathname);
        location.reload();
        return;
      }
      showError(surface);
      loading = undefined;
    } finally {
      pending.length = 0;
      surface.removeAttribute('aria-busy');
      interactive?.removeAttribute('aria-busy');
    }
  }

  function showError(main) {
    if (main.querySelector('[data-load-error]')) return;
    const status = document.createElement('p');
    status.dataset.loadError = '';
    status.setAttribute('role', 'status');
    status.textContent = 'Interactive rankings could not be loaded. Try the control again.';
    main.prepend(status);
  }

  function handle(event) {
    const element = event.target.closest?.(controls);
    if (!element || element.closest('a')) return;
    if (event.type === 'click' && !element.matches('button, [role="button"], [data-school], #atlas-school, [data-add-school], #atlas-add-school')) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key) &&
        !(event.key === 'ArrowDown' && element.matches('[data-school], #atlas-school, [data-add-school], #atlas-add-school'))) return;
    if (event.type === 'keydown' && element.matches('button, select, input[type="radio"], input[type="checkbox"]')) return;
    if (event.type === 'keydown' && event.key === ' ' && element.matches('input, textarea')) return;
    if (event.type === 'click' || event.type === 'keydown') event.preventDefault();
    pending.push({
      ...identify(element),
      type: event.type,
      key: event.key,
      focused: element === document.activeElement,
      value: element.matches('input, select, textarea') ? element.value : undefined,
      checked: element.matches('input[type="checkbox"], input[type="radio"]') ? element.checked : undefined,
    });
    loading ??= activate();
  }

  for (const type of ['click', 'input', 'change', 'keydown']) surface.addEventListener(type, handle);
  surface.addEventListener('submit', event => event.preventDefault());

  if (sessionStorage.getItem('ranking-load-failed') === location.pathname) {
    sessionStorage.removeItem('ranking-load-failed');
    showError(surface);
  } else if (savedTenureFocus || document.currentScript?.dataset.autoload === 'true') {
    loading = activate();
  } else if (location.search) {
    const params = new URLSearchParams(location.search);
    // The finance PhD page puts its defaults in the URL after rendering.
    const defaults = {from:'2015', to:document.querySelector('[name="to"]')?.value,
      journals:'1', window:'10', region:'all', sort:'graduate-publications', order:'desc'};
    if (!document.querySelector('#demo-placement-cohort') ||
        [...params].some(([key, value]) => defaults[key] !== value)) loading = activate();
  }
})();
