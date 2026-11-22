(() => {
  'use strict';
  const card = document.querySelector('[data-demo-ranking="faculty"]');
  if (!card) return;

  const table = card.querySelector('table');
  const header = table.tHead.rows[0];
  const body = table.tBodies[0];
  const program = card.querySelector('[data-faculty-program]');
  const currentSchool = document.createElement('input');
  currentSchool.hidden=true; card.append(currentSchool);
  const cohort = card.querySelector('[data-faculty-cohort]');
  const journals = card.querySelector('[data-faculty-journals]');
  const cutoff = card.querySelector('[data-faculty-cutoff]');
  const search = card.querySelector('[data-faculty-search]');
  const year = card.querySelector('[data-faculty-year]');
  const coverage = card.querySelector('[data-demo-coverage]');
  const settings = card.querySelector('[data-faculty-settings]');
  const pageSize = card.querySelector('[data-faculty-page-size]');
  const prev = card.querySelector('[data-faculty-prev]');
  const next = card.querySelector('[data-faculty-next]');
  let page = 0;
  let evidencePromise;
  const number = new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
  const credits = new Intl.NumberFormat('en-US',{minimumFractionDigits:1,maximumFractionDigits:2});
  const columns = {
    name:'Faculty',
    publications:'Publications',
    citations:'Citation credits',
    school:'Current school',
    program:'PhD university',
  };
  const scoreColumns = new Set(['publications','citations']);
  const numericColumns = new Set(['phdYear',...scoreColumns]);
  const sortControls = new Map();
  let sort = 'publications';

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function message(title, text) {
    const row = element('tr'), cell = element('td'), note = element('div',null,'empty-state');
    cell.colSpan = header.cells.length || 8;
    note.append(element('strong',title),document.createTextNode(text));
    cell.append(note);
    row.append(cell);
    body.replaceChildren(row);
  }

  const normalized = value => value.normalize('NFKD').replace(/\p{Mark}/gu,'').toLowerCase();
  const byName = (a,b) => a.name.localeCompare(b.name);

  function headerCell(text, className) {
    const cell = element('th',text,className);
    cell.scope = 'col';
    header.append(cell);
    return cell;
  }

  function mount(faculty,journalsData) {
    header.replaceChildren();
    const journalGroups=new Map(journalsData);
    const selectedJournals=new Set([...journalGroups].filter(([,group])=>group===0).map(([name])=>name));
    const editor=element('div',null,'tenure-peer-editor journal-custom-editor'); editor.hidden=true;
    const label=element('label','Add:');
    const input=element('input'); input.type='search'; input.placeholder='Search journals'; input.autocomplete='off'; input.setAttribute('aria-label','Add a journal'); input.setAttribute('list','finance-faculty-journal-options');
    const list=element('datalist'); list.id='finance-faculty-journal-options';
    [...journalGroups].sort((a,b)=>a[1]-b[1] || a[0].localeCompare(b[0])).forEach(([name])=>{const item=element('option');item.value=name;list.append(item);});
    window.JournalLabels.attach(input,list);
    const current=element('div',null,'journal-custom-current'), chips=element('div',null,'journal-custom-chips');
    current.append(element('strong','Current:'),chips); label.append(input); editor.append(label,list,current); journals.closest('.demo-controls').after(editor);
    function renderJournals(){
      window.JournalLabels.update(list,name=>selectedJournals.has(name));
      chips.replaceChildren();
      [...selectedJournals].sort((a,b)=>a.localeCompare(b)).forEach(name=>{const button=element('button',`${name} ×`,'secondary-button');button.type='button';button.setAttribute('aria-label',`Remove ${name}`);button.disabled=selectedJournals.size===1;if(button.disabled)button.title='At least one journal is required';button.addEventListener('click',()=>{if(selectedJournals.size>1){selectedJournals.delete(name);renderJournals();reset();}});chips.append(button);});
    }
    input.addEventListener('input',()=>{const name=[...journalGroups.keys()].find(name=>name.toLowerCase()===input.value.trim().toLowerCase());if(name){selectedJournals.add(name);input.value='';renderJournals();reset();}});
    input.addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});
    journals.addEventListener('change',()=>{editor.hidden=journals.value!=='custom';if(!editor.hidden){renderJournals();input.focus();}});
    function included(group,name){return journals.value==='custom'?selectedJournals.has(name):group<=Number(journals.value);}
    function scoreWorks(works){
      let papers=0,matched=0,publications=0,citations=0;
      for(const [year,group,name,cites] of works || []){if(year<=Number(cutoff.value)||!included(group,name))continue;const credit=journals.value==='custom'?1:group===2?.5:1;papers++;publications+=credit;if(cites!=null){matched++;citations+=credit*cites;}}
      return {papers,matched,publications:papers?publications:null,citations:matched?citations:null};
    }
    const programFields = row => row.programLocations || [];
    window.SchoolFilter.suggest(program,faculty.flatMap(programFields));
    window.SchoolFilter.suggest(currentSchool,faculty.map(row=>({name:row.school,code:row.schoolCode})));

    const rankHeader = headerCell('', 'rank-col frozen-rank');
    rankHeader.setAttribute('aria-label', 'Rank');
    for (const [key,label] of Object.entries(columns)) {
      const className = key==='name' ? 'school-col frozen-school' : numericColumns.has(key) ? 'numeric-col' : '';
      const sortable = scoreColumns.has(key);
      const th = headerCell(sortable ? null : label,className);
      if (sortable) {
        const button = element('button',label,'sort-button');
        const arrow = element('span','↓','sort-indicator');
        arrow.setAttribute('aria-hidden','true');
        button.append(arrow);
        button.type = 'button';
        button.addEventListener('click',()=>{
          if (sort===key) return;
          sort = key;
          page = 0;
          draw();
        });
        th.append(button);
        sortControls.set(key,th);
      }
      if (key==='name') window.SchoolFilter.attach(search,th,{
        label:'Search faculty, school or PhD program',placeholder:'Search faculty'
      });
      if (key==='program') window.SchoolFilter.attach(program,th);
      if (key==='school') window.SchoolFilter.attach(currentSchool,th,{label:'Filter by current school',placeholder:'Current school'});
      if (key==='phdYear') window.SchoolFilter.attach(year,th,{
        label:'Filter by PhD graduation year',placeholder:'PhD graduation year'
      });
    }

    function renderRow(row,rank) {
      const tr = element('tr',null,'program-row');
      const rankCell = element('td',null,'rank-col frozen-rank');
      const rankNumber = element('span',rank == null ? '—' : String(rank),'rank-number');
      if (rank != null) rankNumber.prepend(element('sup','#','rank-prefix'));
      rankCell.append(rankNumber);
      tr.append(rankCell);
      for (const key of Object.keys(columns)) {
        const cell = element('td');
        const value = row[key];
        if (key==='name') {
          cell.className = 'school-cell frozen-school';
          const button=element('button','+','group-caret faculty-expand');
          button.type='button'; button.setAttribute('aria-expanded','false'); button.setAttribute('aria-label',`Show details for ${value}`);
          cell.append(button,' ',element('span',value,'faculty-name'));
          let detail;
          button.addEventListener('click',async()=>{
            if (detail) { detail.remove(); detail=null; button.setAttribute('aria-expanded','false'); button.textContent='+'; return; }
            detail=element('tr',null,'detail-row'); const container=detail.insertCell(); container.colSpan=Object.keys(columns).length+1;
            const panel=element('section',null,'detail-panel faculty-detail'); panel.setAttribute('aria-label',`Details for ${value}`);
            panel.append(element('h3',value),element('p',[row.unit,row.school].filter(Boolean).join(' · ')),
              element('p',`PhD: ${row.program || 'Not recorded'}${row.phdYear ? ` (${row.phdYear})` : ''}`));
            const links=element('p',null,'faculty-detail-links');
            for(const [text,url] of [['Profile',row.website],['CV',row.cv]]) {
              if(!/^https?:\/\//i.test(url || '')) continue;
              const link=element('a',text); link.href=url; link.target='_blank'; link.rel='noopener noreferrer'; links.append(link,' ');
            }
            if(row.inTenure) { const link=element('a','Tenure record'); link.href='/rankings/tenure_norms/finance/?faculty='+encodeURIComponent(value); links.append(link); }
            if(links.childNodes.length) panel.append(links);
            const publications=element('div'); publications.append(element('p','Loading recorded publications…')); panel.append(publications);
            container.append(panel); tr.after(detail); button.setAttribute('aria-expanded','true'); button.textContent='−';
            try {
              evidencePromise ??= fetch('/rankings/publication-evidence.json').then(response=>{if(!response.ok) throw new Error('Unavailable'); return response.json();}).catch(error=>{evidencePromise=null;throw error;});
              const evidence=await evidencePromise;
              const works=(evidence[row.facultyId] || []).filter(([year,group,,name])=>year>Number(cutoff.value) && year<=2025 && included(group,name));
              publications.replaceChildren(element('h4',`Recorded publications in the selected journals (${works.length})`));
              if(!works.length) { publications.append(element('p','No matching publications recorded for the selected filters.')); return; }
              const list=element('ul',null,'faculty-publications');
              for(const [year,,title,journal,source,doi] of works) {
                const item=element('li'), url=doi ? `https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi,'/')}` : source;
                if(/^https?:\/\//i.test(url || '')) {const link=element('a',title);link.href=url;link.target='_blank';link.rel='noopener noreferrer';item.append(link);}
                else item.append(document.createTextNode(title));
                item.append(` · ${journal} · ${year}`); list.append(item);
              }
              publications.append(list);
            } catch { publications.replaceChildren(element('p','Publication details could not be loaded.')); }
          });
        } else if (numericColumns.has(key)) {
          cell.className = 'score-cell';
          if (key===sort) cell.classList.add('active-score-column');
          const text = value==null?'—':key==='phdYear'?String(value):key==='publications'?credits.format(value):number.format(value);
          cell.append(element('span',text,'score-number'));
        } else {
          const display=(key==='program' ? row.programLocations?.[0]?.name || value?.split(' · ')[0] : value) || '—';
          if(key==='school' || key==='program'){cell.classList.add('faculty-school-cell');cell.append(element('span',display,'faculty-school-name'));cell.title=value || '';}
          else cell.textContent=display;
          const code = key==='school' ? row.schoolCode : key==='program' ? row.programCode : null;
          if (code !== 'US' && /^[A-Z]{2}$/.test(code || '')) {
            const flag=element('span',String.fromCodePoint(...[...code].map(letter=>0x1F1E6+letter.charCodeAt(0)-65)),'faculty-country-flag');
            flag.setAttribute('role','img'); flag.setAttribute('aria-label',`Country code ${code}`); cell.append(' ',flag);
          }
        }
        tr.append(cell);
      }
      return tr;
    }

    function draw() {
      const terms = normalized(search.value).trim().split(/\s+/);
      const yearTerm = year.value.trim();
      const rows = faculty.map(row=>({...row,...scoreWorks(row.works)}));
      const rankedBy = sort;
      const ranked = rows.filter(row=>row[rankedBy]!=null)
        .sort((a,b)=>b[rankedBy]-a[rankedBy]||byName(a,b));
      let rank = 0;
      const ranks = new Map(ranked.map((row,i)=>{
        if (!i || ranked[i-1][rankedBy]!==row[rankedBy]) rank = i+1;
        return [row,rank];
      }));
      const matching = rows.filter(row=>(cohort.value==='all' || row.phdYear>=Number(cohort.value)) &&
        (!program.value.trim() || programFields(row).some(school=>window.SchoolFilter.matches(school,program.value))) &&
        (!currentSchool.value.trim() || window.SchoolFilter.matches({name:row.school,code:row.schoolCode},currentSchool.value)) && terms.every(term=>row.searchText.includes(term)) &&
        String(row.phdYear ?? '').startsWith(yearTerm));
      matching.sort((a,b)=>{
        const left = a[sort], right = b[sort];
        if (left==null || right==null) return (left==null)-(right==null)||byName(a,b);
        return right-left||byName(a,b);
      });
      table.csvRows=()=>matching.map(row=>[ranks.get(row) ?? '',row.name,row.publications ?? '',
        row.citations ?? '',row.school,row.program ?? '']);
      for (const [key,th] of sortControls) {
        const active = key===sort;
        th.classList.toggle('active-score-column',active);
        th.querySelector('.sort-indicator').textContent=active ? '↓' : '';
        if (active) th.setAttribute('aria-sort','descending');
        else th.removeAttribute('aria-sort');
      }
      rankHeader.title = 'Rank by '+columns[rankedBy].toLowerCase();
      const term = search.value.trim();
      const limit = Number(pageSize.value);
      const start = page * limit;
      const visible = matching.slice(start,start+limit);
      const shown = visible.length ? `${number.format(start+1)}–${number.format(start+visible.length)}` : '0';
      coverage.textContent = `Showing ${shown} of ${number.format(matching.length)} matching faculty${term?` for “${term}”`:''}.`;
      prev.disabled = page === 0;
      next.disabled = start + limit >= matching.length;
      settings.textContent = `Publication years ${Number(cutoff.value)+1}–2025 · ${journals.selectedOptions[0].textContent} · Ranked by ${columns[rankedBy].toLowerCase()}.`;
      const selected=[...journalGroups].filter(([name,group])=>included(group,name));
      const short=entries=>entries.map(([name])=>window.JournalLabels.short(name)).join(', ');
      const core=selected.filter(([,group])=>journals.value==='custom' || group!==2), other=selected.filter(([,group])=>journals.value!=='custom' && group===2);
      card.querySelector('[data-faculty-journal-note]').textContent=`Journals: ${short(core)}${other.length ? `; half credit: ${short(other)}` : ''}.`;
      if (visible.length) body.replaceChildren(...visible.map(row=>renderRow(row,ranks.get(row))));
      else message('No matching faculty','Try changing the search or PhD filters.');
    }

    const reset = () => { page = 0; draw(); };
    for (const select of [cohort,journals,cutoff]) select.addEventListener('change',reset);
    pageSize.addEventListener('change',reset);
    for (const input of [program,currentSchool,search,year]) input.addEventListener('input',reset);
    prev.addEventListener('click',()=>{ page--; draw(); });
    next.addEventListener('click',()=>{ page++; draw(); });
    draw();
  }

  let loading;
  function activate(event) {
    if (loading) return loading;
    const initialSort = event?.target.closest('[data-initial-sort]')?.dataset.initialSort;
    const initialName = event?.target.closest('.faculty-expand')?.getAttribute('aria-label');
    const initialFilter = event?.target.closest('[data-initial-filter]')?.dataset.initialFilter;
    const initialNext = event?.target.closest('[data-faculty-next]');
    card.setAttribute('aria-busy','true');
    loading = fetch('/rankings/demo-rankings.json')
    .then(response=>{
      if (!response.ok) throw new Error('Ranking data unavailable');
      return response.json();
    })
    .then(({faculty,journals})=>{ mount(faculty.map(row=>({
      ...row,searchText:normalized([row.name,row.school,row.unit,row.program,...window.SchoolFilter.aliases(row.school),...window.SchoolFilter.aliases(row.program),...(row.programLocations || []).flatMap(location=>window.SchoolFilter.aliases(location.name))].filter(Boolean).join(' '))
    })),journals);
      if (journals.value === 'custom') journals.dispatchEvent(new Event('change', {bubbles:true}));
      if (initialSort && initialSort !== 'publications') sortControls.get(initialSort)?.querySelector('button')?.click();
      if (initialName) [...card.querySelectorAll('.faculty-expand')].find(button=>button.getAttribute('aria-label')===initialName)?.click();
      if (initialFilter) header.cells[Number(initialFilter)]?.querySelector('.demo-school-filter-button')?.click();
      if (initialNext) next.click();
    })
    .catch(()=>{ loading=null; coverage.textContent='Unable to load interactive rankings. Try again.'; })
    .finally(()=>card.setAttribute('aria-busy','false'));
    return loading;
  }
  table.csvRows=async()=>{
    await activate();
    return loading ? table.csvRows() : null;
  };
  card.addEventListener('change',activate);
  card.addEventListener('input',activate);
  card.addEventListener('click',event=>{if(event.target.closest('button')) activate(event);});
})();
