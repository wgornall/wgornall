/** Private removal-request drafts for a static site.
 * No form POST, telemetry, localStorage, query-string fields, or automatic deletion.
 * The UMD helpers are also used by the Node regression tests.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.PlacementPrivacy = api; api.init(root.document, root.PHD_SITE_CONFIG || {}); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SUBJECT = 'REMOVE MY DATA FROM RANKING';
  const singleLine = (value, max) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
  function emailAddress(value) {
    const address = String(value ?? '').trim();
    // Single plain address only: block mailto query/header injection and recipient lists.
    return address.length <= 254 && /^[A-Za-z0-9.!#$'*+/=^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(address) ? address : '';
  }
  function profileURL(value) {
    if (!String(value ?? '').trim()) return '';
    try { const u = new URL(String(value).trim()); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; }
    catch { return ''; }
  }
  function requestText(fields = {}) {
    const name = singleLine(fields.name, 180);
    if (!name) throw new Error('Enter your professional name.');
    const record = singleLine(fields.record, 120);
    const profile = profileURL(fields.profile);
    if (String(fields.profile || '').trim() && !profile) throw new Error('Use an http or https profile URL.');
    const snapshot = singleLine(fields.snapshot, 40);
    const note = String(fields.note ?? '').trim().slice(0, 1500);
    return [
      'Hello,', '',
      'Please remove my record and associated source excerpts from the public finance PhD rankings and recalculate affected scores.', '',
      `Professional name: ${name}`,
      ...(record ? [`Record ID: ${record}`] : []),
      ...(profile ? [`Public professional profile: ${profile}`] : []),
      ...(snapshot ? [`Dataset snapshot: ${snapshot}`] : []),
      ...(note ? ['', 'Record clarification:', note] : []), '',
      'Please confirm when the request is processed.', '',
      'Thank you.'
    ].join('\n');
  }
  function mailtoURL(email, body) {
    const address = emailAddress(email);
    if (!address) throw new Error('No contact email configured. Nothing has been sent.');
    return `mailto:${address}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(body)}`;
  }
  function init(document, config) {
    const dialog = document?.getElementById('removal-dialog');
    if (!dialog || dialog.dataset.initialized) return;
    dialog.dataset.initialized = 'true';
    const $ = id => document.getElementById(id);
    const form = $('removal-form'), status = $('removal-status');
    const recipient = emailAddress(config.privacyContactEmail);
    let trigger = null, snapshot = '';
    const fields = () => ({ name: $('removal-name').value, record: $('removal-record').value,
      profile: $('removal-profile').value, note: $('removal-note').value, snapshot });
    const say = text => { status.textContent = text; };
    function updatePreview() {
      try { $('removal-preview').value = requestText(fields()); }
      catch { $('removal-preview').value = 'Enter your professional name to prepare the unsent request.'; }
    }
    function prepare() {
      $('removal-name').setCustomValidity($('removal-name').value.trim() ? '' : 'Enter your professional name.');
      const raw = $('removal-profile').value.trim();
      $('removal-profile').setCustomValidity(raw && !profileURL(raw) ? 'Use a public http or https profile URL.' : '');
      if (!form.reportValidity()) return null;
      try {
        const text = requestText(fields());
        $('removal-preview').value = text;
        return text;
      } catch (error) { say(error.message); return null; }
    }
    function open(button) {
      trigger = button;
      form.reset();
      $('removal-name').setCustomValidity(''); $('removal-profile').setCustomValidity('');
      $('removal-draft').open = false;
      snapshot = button.dataset.privacySnapshot || '';
      $('removal-name').value = button.dataset.privacyName || '';
      $('removal-record').value = button.dataset.privacyRecord || '';
      $('removal-profile').value = profileURL(button.dataset.privacyProfile);
      $('removal-email').disabled = !recipient;
      $('removal-contact-note').textContent = recipient
        ? `Send privately to ${recipient}.`
        : 'No contact email configured. Copy or save an unsent draft.';
      say(''); updatePreview();
      dialog.showModal();
      $('removal-name').focus();
    }
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-record]');
      if (!button) return;
      event.preventDefault();
      open(button);
    });
    form.addEventListener('input', () => {
      $('removal-name').setCustomValidity(''); $('removal-profile').setCustomValidity('');
      say(''); updatePreview();
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const text = prepare();
      if (text === null) return;
      if (!recipient) { say('No private recipient is configured. No request has been sent.'); return; }
      const a = document.createElement('a');
      a.href = mailtoURL(recipient, text);
      document.body.append(a); a.click(); a.remove();
      say('Review and send the draft in your email app. Nothing has been submitted.');
    });
    $('removal-copy').addEventListener('click', async () => {
      const text = prepare(); if (text === null) return;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text);
        say('Copied. Email the request to the maintainer.');
      } catch {
        $('removal-draft').open = true;
        $('removal-preview').focus(); $('removal-preview').select();
        say('Copy the selected text and email it to the maintainer.');
      }
    });
    $('removal-download').addEventListener('click', () => {
      const text = prepare(); if (text === null) return;
      const to = recipient ? `To: ${recipient}` : 'To: [maintainer contact not yet configured]';
      const content = `UNSENT REQUEST — no data has been removed\n${to}\nSubject: ${SUBJECT}\n\n${text}\n`;
      const url = URL.createObjectURL(new Blob([content], {type:'text/plain;charset=utf-8'}));
      const a = document.createElement('a');
      a.href = url; a.download = 'phd-ranking-removal-request.txt';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say('Saved as an unsent request. Email it to the maintainer.');
    });
    function clearRequest() {
      form.reset(); snapshot = ''; $('removal-preview').value = ''; say('');
    }
    function closeRequest() { clearRequest(); dialog.close(); }
    $('removal-close').addEventListener('click', closeRequest);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeRequest(); });
    dialog.addEventListener('close', () => {
      // A native close event is queued. Do not clear a newly reopened dialog.
      if (dialog.open) return;
      clearRequest();
      if (trigger?.isConnected) trigger.focus({preventScroll:true});
      trigger = null;
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeRequest();
    });
  }
  return { emailAddress, profileURL, requestText, mailtoURL, init };
});
