(() => {
  'use strict';
  const source = document.getElementById('research-datasets');
  if (source) {
    const {priorFaculty,measures} = JSON.parse(source.textContent);
    for (const root of document.querySelectorAll('[data-research-explorer]')) {
      mount(root, () => measures[root.dataset.researchExplorer], priorFaculty);
    }
  }
  window.mountResearchExplorer = mount;

  function mount(root, load, priorFaculty, {atlas = false, showPerCapita = true, getCustomJournals} = {}) {
    root.dataset.unitLabel = 'universities';
    const titleNode = root.querySelector('.ranking-card-title');
    if (titleNode) titleNode.textContent = titleNode.textContent.replace(/Finance (?:departments|universities) ranked by publication counts/i, 'Universities ranked by finance publication counts').replace(/Finance (?:departments|universities) ranked by citations/i, 'Universities ranked by finance citations');
    const schoolHeader = root.querySelector('thead .school-col span');
    if (schoolHeader) schoolHeader.textContent = 'University';
    const methodology = root.querySelector('.demo-table-notes');
    if (methodology && showPerCapita) for (const node of methodology.querySelectorAll('p')) {
      for (const child of node.childNodes) if (child.nodeType===Node.TEXT_NODE) child.textContent = child.textContent.replace(/Raw per capita divides by the university’s faculty count\.\s*/g, '').replace(/Raw per capita divides by the sampled faculty count\.\s*/g, '');
    }
    const regionNav = document.querySelector('[data-research-region]');
    const region = regionNav?.dataset.researchRegion || 'global';
    const regional = region !== 'global';
    const regionLabel = regionNav?.dataset.regionLabel;
    const belongs = row => {
      const {country, countryCode} = row;
      switch (region) {
        case 'us': return country === 'United States' || countryCode === 'US';
        case 'canada': return country === 'Canada' || countryCode === 'CA';
        case 'uk': return country === 'United Kingdom' || countryCode === 'GB';
        case 'europe': return row.region === 'Europe' && country !== 'United Kingdom' && countryCode !== 'GB';
        case 'asia': return row.region === 'Asia';
        case 'australia': return country === 'Australia' || countryCode === 'AU';
        default: return true;
      }
    };
    const pick = name => root.querySelector(`[data-research-${name}]`);
    const search = pick('search');
    const markSchoolFilter=window.SchoolFilter.attach(search,root.querySelector('thead .school-col'));
    const citation = root.dataset.researchExplorer === 'citation';
    if (!showPerCapita) {
      for (const metric of ['bayes','raw']) root.querySelector(`[data-research-sort="${metric}"]`)?.closest('th')?.remove();
      const columns=root.querySelectorAll('colgroup col');
      columns[3]?.remove(); columns[2]?.remove();
    }
    if (regional) {
      root.classList.add('demo-regional-research');
      root.querySelector('thead .rank-col')?.setAttribute('title', 'Regional rank, with global rank below');
    }
    let [data,groups] = load();
    const cutoff = pick('cutoff'), filterChoice = pick('filter'), size = pick('page-size');
    if (regional && !atlas && !citation) filterChoice.value = '2';
    if (regional) {
      size.prepend(new Option('10', '10'));
      size.value = '10';
    }
    const body = pick('rows'), note = pick('settings'), coverage = pick('coverage');
    const pageStatus = pick('page-status');
    const previous = [...root.querySelectorAll('[data-research-prev]')];
    const next = [...root.querySelectorAll('[data-research-next]')];
    const buttons = [...root.querySelectorAll('[data-research-sort]')];
    const metrics = buttons.map(button => button.dataset.researchSort);
    const number = new Intl.NumberFormat('en-US');
    const score = new Intl.NumberFormat('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
    const authorScore = new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    const open = new Set();
    let sort = showPerCapita ? 'bayes' : 'top', page = 0, exportRows = [];

    const params=new URLSearchParams(location.search);
    const shared=params.get('table')===root.id;
    const restoreOption=(control,key)=>{
      const value=params.get(key);
      if(shared && [...control.options].some(option=>option.value===value)) control.value=value;
    };
    function updateShareLinks() {
      const url=new URL(location.href);
      url.hash=root.id;
      for (const [key,value] of Object.entries({table:root.id,filter:filterChoice.value,after:cutoff.value,
        sort,rows:size.value,page:String(page+1)})) url.searchParams.set(key,value);
      if(search.value.trim()) url.searchParams.set('school',search.value.trim());
      else url.searchParams.delete('school');
      url.searchParams.delete('journal');
      if(filterChoice.value==='custom'){
        const names=getCustomJournals ? getCustomJournals() : [...customSelection].map(id=>data.customJournals[id]);
        for(const name of names) url.searchParams.append('journal',name);
      }
      for(const link of root.querySelectorAll('[data-research-share] a')){
        const intent=new URL(link.href);
        intent.searchParams.set('url',url.href);
        if(intent.hostname==='twitter.com') intent.searchParams.set('text',root.querySelector('h2').textContent);
        link.href=intent.href;
      }
    }

    const schoolFields = (school,code,country,alias,region) =>
      ({name:school,country,region,code,aliases:[alias]});
    function element(tag,text,className) {
      const node = document.createElement(tag);
      if (text != null) node.textContent = text;
      if (className) node.className = className;
      return node;
    }
    let customSelection;
    if (!atlas && !citation && data.customWorks) {
      customSelection = new Set(data.customJournals.slice(0,data.customCoreCount).map((_,id)=>id));
      const option=element('option','Custom journals'); option.value='custom'; filterChoice.append(option);
      const editor=element('div',null,'tenure-peer-editor journal-custom-editor'); editor.hidden=true;
      const label=element('label','Add:'), input=element('input');
      input.type='search'; input.placeholder='Search journals'; input.autocomplete='off'; input.setAttribute('aria-label','Add a journal'); input.setAttribute('list','finance-research-journal-options');
      const list=element('datalist'); list.id='finance-research-journal-options';
      data.customJournals.forEach(name=>{const item=element('option');item.value=name;list.append(item);});
      window.JournalLabels.attach(input,list);
      const current=element('div',null,'journal-custom-current'), chips=element('div',null,'journal-custom-chips');
      current.append(element('strong','Current:'),chips);label.append(input);editor.append(label,list,current);filterChoice.closest('.demo-controls').after(editor);
      function renderJournals(){
        window.JournalLabels.update(list,name=>customSelection.has(data.customJournals.indexOf(name)));
        chips.replaceChildren();
        [...customSelection].sort((a,b)=>data.customJournals[a].localeCompare(data.customJournals[b])).forEach(id=>{
          const name=data.customJournals[id],button=element('button',`${name} ×`,'secondary-button');button.type='button';button.setAttribute('aria-label',`Remove ${name}`);button.disabled=customSelection.size===1;
          if(button.disabled)button.title='At least one journal is required';
          button.addEventListener('click',()=>{if(customSelection.size>1){customSelection.delete(id);renderJournals();reset();}});chips.append(button);
        });
      }
      if(shared && params.get('filter')==='custom'){
        const ids=params.getAll('journal').map(name=>data.customJournals.indexOf(name)).filter(id=>id>=0);
        if(ids.length) customSelection=new Set(ids);
        editor.hidden=false;
        renderJournals();
      }
      input.addEventListener('input',()=>{const id=data.customJournals.findIndex(name=>name.toLowerCase()===input.value.trim().toLowerCase());if(id>=0){customSelection.add(id);input.value='';renderJournals();reset();}});
      input.addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});
      filterChoice.addEventListener('change',()=>{editor.hidden=filterChoice.value!=='custom';if(!editor.hidden){renderJournals();input.focus();}});
    }
    if(shared){
      restoreOption(filterChoice,'filter');
      restoreOption(cutoff,'after');
      restoreOption(size,'rows');
      if(metrics.includes(params.get('sort'))) sort=params.get('sort');
      search.value=params.get('school') || '';
      markSchoolFilter();
      const requestedPage=Number(params.get('page'));
      if(Number.isSafeInteger(requestedPage) && requestedPage>0) page=requestedPage-1;
    }
    function customWindow(after) {
      const allWorks=new Set(), unitCoverage=[], unitScores=[];
      for(const [unitIndex,entries] of data.customWorks.entries()) {
        const works=new Set(), scores=new Map();
        for(const [year,journal,author,work] of entries) {
          if(year<=after || !customSelection.has(journal))continue;
          works.add(work);allWorks.add(work);scores.set(author,(scores.get(author)||0)+1);
        }
        const top=[...scores].sort((a,b)=>b[1]-a[1]||data.authors[a[0]].localeCompare(data.authors[b[0]])).slice(0,4);
        unitCoverage.push([works.size,works.size,scores.size]);
        const largestNames=new Set(data.largestUnitMembers?.[unitIndex] || []);
        const largestTotal=[...scores].filter(([id])=>largestNames.has(data.authors[id])).reduce((sum,[,value])=>sum+value,0);
        unitScores.push([scores.size?[...scores.values()].reduce((a,b)=>a+b,0):null,top.length?top.reduce((a,row)=>a+row[1],0):null,top,[scores.size?largestTotal:null,largestNames.size,'']]);
      }
      return [allWorks.size,allWorks.size,unitCoverage,unitScores];
    }
    const byName = (a,b) => a.school.localeCompare(b.school) || a.unit.localeCompare(b.unit);
    function unitLabel(school,unit) {
      const label = unit.startsWith(school+' ') ? unit.slice(school.length).replace(/^[\s·—:-]+/,'') : unit;
      if (atlas) return label;
      const withoutFinance = label.replace(/(?:\s+[·/—]\s+|,\s+)(?:finance(?: academic group| subject group| group| division)?|department of finance|faculty of finance)$/i,'');
      return /^(?:finance|department of finance)$/i.test(withoutFinance) ? '' : withoutFinance;
    }
    function compare(a,b,metric) {
      const difference = b.scores[metric]-a.scores[metric];
      return Math.abs(difference)>1e-10 ? difference : 0;
    }
    function ranksFor(rows,metric) {
      const ordered=rows.filter(row=>row.scores[metric]!=null).sort((a,b)=>compare(a,b,metric)||byName(a,b));
      const ranks=new Map();
      let rank=0;
      ordered.forEach((row,i)=>{
        if (!i || compare(row,ordered[i-1],metric)) rank=i+1;
        ranks.set(row.id,rank);
      });
      return ranks;
    }

    function detail(row, groups) {
      const tr=element('tr',null,'detail-row');
      const cell=element('td');
      cell.colSpan=metrics.length+3;
      const panel=element('section',null,'detail-panel research-detail-panel');
      const details=element('div',null,'research-detail-groups');
      const units=groups[row.school] || [];
      panel.append(element('h3',`${row.school} · ${number.format(row.headcount)} sampled faculty`));
      if (showPerCapita) {
        const department = row.largestName || [...units].sort((a,b)=>b[2].length-a[2].length)[0]?.[0] || 'the largest department';
        panel.append(element('p',`Per capita scores use the higher of the university-wide score and ${unitLabel(row.school,department) || department}. An asterisk marks scores based on the department.`));
      }
      const rosterSource = data.unitRosterSources?.[row.school]?.[row.unit] || data.rosterSources?.[row.school];
      if (rosterSource?.startsWith('https://')) {
        const link = element('a','Official faculty directory');
        link.href = rosterSource;
        panel.append(link);
      }
      if (row.leaders.length) {
        const group=element('div');
        group.append(element('h4',row.label?`Top authors in ${row.label}`:'Top authors'));
        const list=element('ul');
        for (const [name,credit] of row.leaders) list.append(element('li',`${name} · ${authorScore.format(credit)}`));
        group.append(list);
        details.append(group);
      }
      for (const [unit,eligible,members] of units) {
        const group=element('div');
        group.append(element('h4',`${unitLabel(row.school,unit) || 'Faculty'} (${members.length})`));
        const list=element('ul');
        for (const name of members) {
          const url = data.facultyProfiles?.[row.school]?.[name];
          const profile = url?.startsWith('https://') ? url : null;
          const item = element('li',profile ? null : name);
          if (profile) {
            const link = element('a',name);
            link.href = profile;
            item.append(link);
          }
          list.append(item);
        }
        group.append(list);
        details.append(group);
      }
      panel.append(details);
      cell.append(panel);
      tr.append(cell);
      return tr;
    }

    function draw(restoreRow) {
      const [papers,matched,schoolCoverage,unitScores]=data.getWindow
        ? data.getWindow(filterChoice.value,Number(cutoff.value)) : filterChoice.value==='custom'
          ? customWindow(Number(cutoff.value)) : data.filters[filterChoice.value][cutoff.value];
      const rows=data.schools.map(([school,headcount,,unit,countryCode,country,alias,region],id)=>{
        const [total,top,leaders,largest]=unitScores[id];
        const [largestTotal,largestCount,largestName] = largest || [null,0,''];
        const perCapita = (count, prior) => total==null ? null : Math.max(total/(count+prior), largestCount && largestTotal!=null ? largestTotal/(largestCount+prior) : 0);
        const [works,scored,covered]=schoolCoverage[id];
        return {id,school,unit,countryCode,country,alias,region,headcount,works,scored,covered,
          key:`${school}|${unit}`,label:unitLabel(school,unit),
          leaders:leaders.map(([index,credit])=>[data.authors[index],credit]),
          largestName,largestTotal,largestCount,scores:{bayes:perCapita(headcount,priorFaculty),raw:headcount<5?null:perCapita(headcount,0),top,total}};
      }).filter(row=>row.headcount >= 5);
      const globalRanks=Object.fromEntries(metrics.map(metric=>[metric,ranksFor(rows,metric)]));
      const regionalRows=regional ? rows.filter(belongs) : rows;
      const rankings=regional ? Object.fromEntries(metrics.map(metric=>[metric,ranksFor(regionalRows,metric)])) : globalRanks;
      root.dataset.rankedDepartments=String(rankings[sort].size);
      const heading=root.querySelector('.ranking-card-title');
      if (regional && !heading.querySelector('[data-region-title]')) {
        const prefix=element('span',regionLabel+' · ');
        prefix.dataset.regionTitle='';
        heading.prepend(prefix);
        const caption=root.querySelector('caption');
        caption.textContent=regionLabel+' · '+caption.textContent;
      }
      const suggestions=new Map();
      for (const row of regionalRows) {
        const rank=rankings[sort].get(row.id) ?? Infinity;
        if (!suggestions.has(row.school) || rank<suggestions.get(row.school).rank)
          suggestions.set(row.school,{...schoolFields(row.school,row.countryCode,row.country,row.alias,row.region),rank});
      }
      window.SchoolFilter.suggest(search,[...suggestions.values()],{ranked:true});
      const term=search.value.trim();
      const matching=regionalRows.filter(row=>window.SchoolFilter.matches(
        schoolFields(row.school,row.countryCode,row.country,row.alias,row.region),term));
      matching.sort((a,b)=>{
        const left=rankings[sort].get(a.id),right=rankings[sort].get(b.id);
        if (left==null || right==null) return (left==null)-(right==null)||byName(a,b);
        return left-right||byName(a,b);
      });
      exportRows = matching.map(row => [rankings[sort].get(row.id) ?? '', ...(regional ? [globalRanks[sort].get(row.id) ?? ''] : []), row.school, row.country || '',
        ...metrics.map(metric => row.scores[metric] ?? ''), citation ? `${row.scored}/${row.works}` : row.headcount]);
      const pageSize=Number(size.value);
      page=Math.min(page,Math.max(0,Math.ceil(matching.length/pageSize)-1));
      updateShareLinks();
      const start=page*pageSize;
      const visible=matching.slice(start,start+pageSize);
      for (const button of buttons) {
        const active=button.dataset.researchSort===sort;
        const header=button.closest('th');
        header.classList.toggle('active-score-column',active);
        if (active) header.setAttribute('aria-sort','descending');
        else header.removeAttribute('aria-sort');
        button.querySelector('.sort-indicator').textContent=active?'↓':'';
      }
      body.replaceChildren();
      if (!visible.length) {
        const row=body.insertRow(),cell=row.insertCell();
        cell.colSpan=metrics.length+3;
        cell.textContent='No universities match the current filters.';
      }
      let focusButton;
      for (const row of visible) {
        const expanded=open.has(row.key);
        const tr=element('tr',null,`program-row university-row${expanded?' open':''}`);
        const rank=element('td',rankings[sort].has(row.id)?`#${rankings[sort].get(row.id)}`:'—','rank-col frozen-rank');
        if (regional) {
          const worldRank=globalRanks[sort].get(row.id);
          if (worldRank != null) rank.append(element('small',`#${worldRank} global`,'research-global-rank'));
        }
        const school=element('td',null,'school-cell frozen-school');
        const button=element('button',null,'school-button');
        button.type='button';
        button.setAttribute('aria-expanded',String(expanded));
        const schoolLabel=[row.school,row.label,row.country].filter(Boolean).join(', ');
        button.setAttribute('aria-label',`Sampled faculty roster for ${schoolLabel}`);
        button.title=schoolLabel;
        const caret=element('span',expanded?'−':'+','group-caret');
        caret.setAttribute('aria-hidden','true');
        button.append(caret,element('span',row.school,'school-name'));
        if (row.countryCode!=='US' && /^[A-Z]{2}$/.test(row.countryCode)) {
          const flag=String.fromCodePoint(...[...row.countryCode].map(letter=>0x1F1E6+letter.charCodeAt(0)-65));
          const flagIcon=element('span',flag,'research-country-flag');
          flagIcon.setAttribute('aria-hidden','true');
          button.append(flagIcon);
        }
        button.addEventListener('click',()=>{
          if (open.has(row.key)) open.delete(row.key);
          else open.add(row.key);
          draw(row.key);
        });
        if (restoreRow===row.key) focusButton=button;
        school.append(button);
        if (row.label) school.append(element('small',row.label,'research-unit-label'));
        tr.append(rank,school);
        for (const metric of metrics) {
          const value=row.scores[metric];
          const cell=element('td',null,`score-cell${metric===sort?' active-score-column':''}`);
          let usesDivision = false;
          if ((metric==='bayes' || metric==='raw') && value!=null) {
            const prior = metric==='bayes' ? priorFaculty : 0;
            usesDivision = !!row.largestCount && row.largestTotal!=null && row.largestTotal/(row.largestCount+prior) > row.scores.total/(row.headcount+prior);
            const department = row.largestName || [...(groups[row.school] || [])].sort((a,b)=>b[2].length-a[2].length)[0]?.[0] || 'the largest department';
            cell.title = usesDivision ? `Based on ${department} (${row.largestCount} faculty).` : `Based on the university (${row.headcount} faculty).`;
          }
          const scoreLabel = element('span',value==null?'—':score.format(value),'score-number');
          if (usesDivision) {
            const marker = element('span','*','research-department-marker');
            marker.style.opacity = '0.5';
            marker.setAttribute('aria-label',' based on largest department');
            scoreLabel.append(marker);
          }
          if (value!=null) scoreLabel.append(` (#${rankings[metric].get(row.id)})`);
          cell.append(scoreLabel);
          tr.append(cell);
        }
        const coverageCell = element('td',citation?`${row.scored}/${row.works}`:String(row.headcount),'score-cell');
        if (!citation) coverageCell.title = `${row.covered} of ${row.headcount} faculty have a matched article in the selected journals and years.`;
        tr.append(coverageCell);
        body.append(tr);
        if (expanded) body.append(detail(row,groups));
      }
      focusButton?.focus({preventScroll:true});
      previous.forEach(button=>{button.disabled=page===0;});
      next.forEach(button=>{button.disabled=start+pageSize>=matching.length;});
      const unitNoun = root.dataset.unitLabel || 'units';
      pageStatus.textContent=matching.length?`${start+1}–${start+visible.length} of ${matching.length} ${unitNoun}`:`0 ${unitNoun}`;

      const end=Number(root.dataset.publicationEnd);
      const citationYears=filterChoice.value==='all'?'all years':`${end-Number(filterChoice.value)+1}–${end}`;
      const selection=citation?`Citations over ${citationYears}`:filterChoice.selectedOptions[0].textContent;
      const settings=`Publication years ${Number(cutoff.value)+1}–${end} · ${selection}${term?` · Filtered by ${term}`:''}.`;
      if (note.textContent!==settings) note.textContent=settings;
      const journalsNote=pick('journals');
      if (!atlas && journalsNote && data.journalNames) {
        const short=names=>names.map(window.JournalLabels.short).join(', ');
        const names=data.journalNames;
        if (citation) journalsNote.textContent=`Journals: ${short(names.slice(0,data.topJournalCount))}.`;
        else if (filterChoice.value==='custom') journalsNote.textContent=`Journals: ${short([...customSelection].map(id=>data.customJournals[id]))}.`;
        else {
          const selected=Number(filterChoice.value), end=selected===0?3:data.topJournalCount;
          journalsNote.textContent=`Journals: ${short(names.slice(0,end))}${selected===2 ? `; half credit: ${short(names.slice(data.topJournalCount))}` : ''}.`;
        }
      }
      if (showPerCapita && !root.querySelector('[data-largest-unit-note]')) {
        const explanation=element('span','Per-capita scores use the higher of the university and its largest division; faculty counts are for the university.');
        explanation.dataset.largestUnitNote='';
        root.querySelector('.demo-table-notes p:last-of-type')?.append(' ',explanation);
      }
      coverage.textContent=citation
        ? `Across all schools, ${number.format(matched)} of ${number.format(papers)} recorded articles have citation data for this window.`
        : `${number.format(papers)} recorded articles ${atlas?'in the selected field':'across all schools'} match the publication settings.`;
    }

    function reset() { page=0; draw(); }
    for (const control of [cutoff,filterChoice,size]) control.addEventListener('change',reset);
    search.addEventListener('input',reset);
    for (const button of buttons) button.addEventListener('click',()=>{
      if (button.dataset.researchSort===sort) return;
      sort=button.dataset.researchSort;
      reset();
    });
    previous.forEach(button=>button.addEventListener('click',()=>{page--;draw();}));
    next.forEach(button=>button.addEventListener('click',()=>{page++;draw();}));
    root.querySelector('[data-research-download]')?.addEventListener('click',()=>{
      const metricNames={bayes:'Per capita (Bayes)',raw:'Per capita (Raw)',top:'Top four authors',total:'Total'};
      const headings = [...(regional ? ['Regional rank','Global rank'] : ['Rank']),'University','Country',...metrics.map(metric=>metricNames[metric]),citation?'Articles scored':'Faculty'];
      const csvCell = value => {
        let text = String(value);
        if (/^[\s]*[=+@\-]/.test(text) && typeof value === 'string') text = "'" + text;
        return '"' + text.replace(/"/g,'""') + '"';
      };
      const csv = [headings,...exportRows].map(row=>row.map(csvCell).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${root.dataset.researchExplorer}${regional ? '-'+region : ''}-rankings.csv`;
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    draw();
    return () => {
      [data,groups]=load();
      open.clear();
      reset();
    };
  }
})();
