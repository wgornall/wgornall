(() => {
  'use strict';
  const selector='main table';
  const installed=new WeakSet();
  const cell=value=>`"${String(value??'').replace(/^[\t\r ]*([=+@-])/,'\u0027$1').replaceAll('"','""')}"`;
  function scopeFor(table) {
    const owner=table.closest('[data-case-table], [data-demo-ranking], [data-research-explorer], #atlas-field-rankings, section, article');
    if(owner) return owner;
    let parent=table.parentElement;
    while(parent?.parentElement && parent.querySelectorAll('table').length===1) {
      if(parent.querySelector('[data-case-next], [data-faculty-next], #atlas-next, [data-next]')) return parent;
      parent=parent.parentElement;
    }
    return table.parentElement;
  }
  function rows(table) {
    return [...table.tBodies].flatMap(body=>[...body.rows]).filter(row=>row.cells.length>1 && !row.hidden)
      .map(row=>[...row.cells].map(c=>c.innerText.trim().replace(/\s+/g,' ')));
  }
  async function download(table,button) {
    button.disabled=true;
    try {
      const all=table.csvRows ? await table.csvRows() : rows(table);
      if (!all) return;
      const headers=table.tHead ? [...table.tHead.rows].at(-1) : null;
      const labels=headers ? [...headers.cells].map(c=>c.innerText.trim().replace(/\s+/g,' ') || c.getAttribute('aria-label') || '') : [];
      const csv=[labels,...all].map(row=>row.map(cell).join(',')).join('\r\n');
      const url=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download='table.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } finally {button.disabled=false;}
  }
  function install() {
    for(const table of document.querySelectorAll(selector)) {
      if(installed.has(table) || table.closest('template')) continue;
      const scope=scopeFor(table);
      if(scope.querySelector('[data-research-download], #export-button')) {installed.add(table);continue;}
      installed.add(table);
      const button=scope.querySelector('[data-table-download]') || (table.previousElementSibling?.matches('[data-table-download]') ? table.previousElementSibling : document.createElement('button'));
      button.type='button';button.className='caption-icon';button.setAttribute('aria-label','Download table as CSV');button.title='Download table as CSV';button.dataset.tableDownload='';
      button.style.margin='';
      button.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></svg>';
      button.addEventListener('click',()=>{
        // Prerendered pages replay this click after their interactive tables load.
        if(document.querySelector('script[data-source][data-ready]')) return;
        download(table,button);
      });
      const actions=scope.querySelector(':scope > .ranking-card-header .caption-actions, :scope > .ranking-top-actions .caption-actions');
      if(actions) actions.append(button);
      else {
        const heading=scope.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > [data-table-download-header] > h1, :scope > [data-table-download-header] > h2, :scope > [data-table-download-header] > h3');
        if(heading) {
          let header=heading.parentElement.matches('[data-table-download-header]') ? heading.parentElement : null;
          if(!header) { header=document.createElement('div');header.dataset.tableDownloadHeader='';header.style.display='flex';header.style.alignItems='center';header.style.justifyContent='space-between';header.style.gap='12px';heading.before(header);header.append(heading); }
          header.append(button);
        } else {button.style.display='flex';button.style.margin='0 0 8px auto';if(!button.isConnected)table.before(button);}
      }
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
  new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});
})();
