(() => {
  'use strict';
  const paths = {phd:'phd_rankings',research:'research_rankings',faculty:'faculty_rankings',tenure:'tenure_norms'};
  const slugs = {Combined:'combined',Finance:'finance',Accounting:'accounting',Economics:'economics',Marketing:'marketing',Management:'management','Operations & IS':'operations'};
  const route = (view,field) => `/rankings/${paths[view]}/${slugs[field === 'Combined' && view !== 'research' ? 'Finance' : field] || encodeURIComponent(field.toLowerCase())}/`;
  const finance = Object.fromEntries(Object.keys(paths).map(view=>[view,route(view,'Finance')]));
  const views = {
    phd: ['PhD programs ranked by graduates’ outcomes','credits',[['label','PhD Granter, Location'],['count','# tracked'],['credits','Graduates combined'],['current',"Graduates' employers"]]],
    research: ['Universities ranked by publication counts'],
    tenure: ['Tenure norms'],
    faculty: ['Faculty ranked by publications','credits',[['label','Faculty'],['credits','Publications'],['school','Current school'],['program','PhD university']]]
  };
  const params = new URLSearchParams(location.search);
  const routeParts = location.pathname.slice('/rankings/'.length).split('/').filter(Boolean);
  const routeView = Object.keys(paths).find(key=>paths[key]===routeParts[0]);
  const routeField = Object.keys(slugs).find(key=>slugs[key]===routeParts[1]);
  const view = routeView || (Object.hasOwn(views,params.get('view')) ? params.get('view') : location.pathname === '/rankings/' ? 'phd' : 'research');
  const requestedName = (routeField==='Economics' && !routeParts[2] && params.get('kind')==='primary' && params.get('field')?.startsWith('Economics:') ? params.get('field') : routeField) || params.get('field') || (view === 'research' || view === 'phd' ? 'Finance' : null);
  const requestedKind = routeView==='research' && routeField==='Economics' && routeParts[2] ? 'group' : (params.get('kind') || 'group');
  const economicsBundles = {
    'applied-micro': ['Applied micro',['Behavioral & Experimental','Education','Environment, Energy & Agriculture','Health','Industrial Organization','Labor','Law & Economics','Political Economy','Public','Urban & Regional']],
    'methods-theory': ['Methods and theory',['Econometrics','Microeconomic Theory']],
    'macro-international': ['Macro and international',['Macro & Monetary','International']],
    'development-history': ['Development and history',['Development','Economic History']]
  };
  const root = document.querySelector('#atlas-field-rankings');
  const control = name => root.querySelector(`#atlas-${name}`);
  const journals = control('journals'), cutoff = control('cutoff');
  const journalList = control('journal-list');
  const search = control('search');
  const program = control('program'), first = control('from'), last = control('to');
  const school = control('school');
  const pageSize = control('page-size');
  const table = root.querySelector('table'), body = table.tBodies[0];
  const [title,defaultSort,columns] = views[view];
  const isPhd = view==='phd', isFaculty = view==='faculty', isTenure = view==='tenure';
  if (isTenure) {
    const intro=control('tenure-intro'), warning=control('data-warning');
    const inline=document.createElement('span');
    inline.id=warning.id;
    inline.className='demo-inline-warning';
    inline.append(...warning.childNodes);
    warning.remove();
    intro.append(' ',inline);
    intro.hidden=false;
  }
  const currentSchool = isFaculty ? document.createElement('input') : null;
  if (currentSchool) { currentSchool.hidden=true; root.append(currentSchool); }
  const hasRankColumn = isPhd || isFaculty;
  const format = new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
  const creditFormat = new Intl.NumberFormat('en-US',{minimumFractionDigits:1,maximumFractionDigits:2});
  const normalize = value => value.normalize('NFKD').replace(/\p{Mark}/gu,'').toLowerCase();
  const scoreColumns = new Set(isPhd ? ['credits','current'] : ['credits']);
  const rateText = value => value==null?'—':value>0 && value<0.005?'<0.01':value.toFixed(2);
  let sort = defaultSort, page = 0;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function labeledControl(text, input) {
    const label=element('label',text);
    label.append(input);
    return label;
  }

  function option(parent, value, label) {
    const node = element('option',label);
    node.value = value;
    parent.append(node);
  }

  function fieldURL(destination, name, kind = 'group') {
    const region = routeView === 'research' && destination === 'research' ? routeParts[2] : null;
    const fieldRoute = field => route(destination,field) + (region && field === routeField ? region+'/' : '');
    if (kind==='bundle') return `${fieldRoute('Economics')}?subfield=${encodeURIComponent(name)}`;
    if (slugs[name]) return fieldRoute(name);
    return route(destination,'Economics')+'?'+new URLSearchParams({field:name,kind});
  }

  const mainFields = [...document.querySelectorAll('[data-nav-field]')];
  const siteViews = document.querySelectorAll('[data-site-view]');
  for (const link of mainFields) link.href = fieldURL(view,link.dataset.navField);
  for (const link of siteViews) {
    link.href = fieldURL(link.dataset.siteView,requestedName,requestedKind);
    if (link.dataset.siteView===view) link.setAttribute('aria-current','page');
  }

  const visibleControls = {
    'data-warning':isTenure, 'tenure-controls':isTenure, 'table-scroll':!isTenure,
    'search-control':!isTenure&&!isFaculty, pager:!isTenure, 'scroll-note':isFaculty
  };
  for (const [name,visible] of Object.entries(visibleControls)) control(name).hidden = !visible;
  pageSize.parentElement.hidden = !(isPhd || isFaculty);
  control('search-label').textContent = {phd:'Filter by school, region, or country',research:'Find a school or unit',faculty:'Find a faculty member'}[view] || '';
  search.placeholder = isPhd ? 'School, region, or country' : control('search-label').textContent;
  if (isPhd) search.autocomplete = 'off';
  const options = control('options'), coverage = control('coverage');
  const researchCard = view==='research'
    ? document.querySelector('#atlas-research-template').content.firstElementChild.cloneNode(true) : null;
  const counting = element('span',', counting');
  counting.className = 'demo-phd-comma';
  if (hasRankColumn) {
    const columnClasses = isPhd
      ? ['rank-col','school-col','window-col demo-tracked-col','window-col','window-col']
      : ['rank-col','school-col','faculty-score-col','',''];
    table.className = isPhd
      ? 'rankings-table demo-placement-table demo-atlas-phd-table'
      : 'rankings-table demo-faculty-table';
    table.tHead.rows[0].className = 'metric-group-row';
    const caption = table.createCaption();
    caption.className = 'sr-only';
    caption.textContent = isPhd ? 'Expand a program to see its tracked graduates and their outcomes.' : 'Faculty rankings by publications.';
    const colgroup = element('colgroup');
    for (const className of columnClasses) {
      const col = element('col');
      col.className = className;
      colgroup.append(col);
    }
    caption.after(colgroup);
  }
  if (isPhd) {
    options.classList.remove('demo-placement-cohort','demo-phd-sentence');
    options.classList.add('demo-research-filters','demo-phd-filters');
    options.replaceChildren(labeledControl('PhD year from',first),labeledControl('To',last),
      labeledControl('Journals',journals),labeledControl('Publication window',cutoff));
    cutoff.setAttribute('aria-label','Publication window');
    coverage.parentElement.classList.add('sr-only');
    root.classList.add('demo-atlas-phd-card');
    control('table-scroll').setAttribute('aria-label','Scrollable PhD rankings. Rank and school stay frozen.');
  } else if (isFaculty) {
    options.classList.remove('demo-placement-cohort','demo-phd-sentence');
    options.classList.add('demo-research-filters','demo-faculty-sentence');
    options.replaceChildren(labeledControl('Journals',journals),labeledControl('Published after',cutoff));
    options.setAttribute('aria-label','Faculty ranking options');
    root.parentElement.className = 'page-shell demo-faculty-shell';
    document.querySelector('.demo-nav').classList.replace('demo-nav-card','demo-nav-phd');
    control('table-scroll').setAttribute('aria-label','Scrollable faculty rankings. Rank and faculty stay frozen.');
    const coverageLine = coverage.parentElement;
    control('settings').before(coverage,' ');
    coverageLine.remove();
  } else if (researchCard) {
    researchCard.querySelector('[data-research-filter]').replaceWith(journals);
    journals.setAttribute('data-research-filter','');
    journals.setAttribute('aria-label','Journals counted');
    researchCard.querySelector('[data-research-settings]').after(' ',control('source-note'),' ',journalList,' ');
  } else {
    cutoff.setAttribute('aria-label','Cases since');
    options.classList.remove('demo-placement-cohort','demo-phd-sentence');
    options.classList.add('demo-research-filters');
    options.setAttribute('aria-label','Publication chart options');
    const adjustment=element('select');
    adjustment.id='atlas-year-adjustment';
    option(adjustment,'off','No percentiles');
    option(adjustment,'none','By tenure');
    option(adjustment,'linear','Scaled by years out');
    option(adjustment,'minus5','Scaled by years out plus 5');
    options.replaceChildren(labeledControl('Journals',journals),labeledControl('Cases since',cutoff),labeledControl('Percentiles',adjustment));
    root.querySelector('#atlas-chart-title').after(options);
    root.classList.add('demo-atlas-tenure-card');
    const coverageLine = coverage.parentElement;
    control('settings').before(coverage,' ');
    coverageLine.remove();
  }

  function mount(data) {
    const {groups,primary,tags,units,papers,end} = data;
    const groupFor = i => primary[i]?.split(':',1)[0];
    const taxonomy = {group:groups,primary,tag:tags};
    const names = Object.hasOwn(taxonomy,requestedKind) ? taxonomy[requestedKind] : [];
    const isCombined = requestedName === 'Combined';
    let index = isCombined ? 0 : requestedKind==='primary' && requestedName.startsWith('Finance:')
      ? -1 : names.indexOf(requestedName);
    if (index<0) {
      location.replace(finance[view]);
      return;
    }
    const regionalEconomics = view==='research' && requestedName==='Economics' && !!routeParts[2];
    const initialBundle = !regionalEconomics && requestedName==='Economics' && Object.hasOwn(economicsBundles,params.get('subfield')) ? params.get('subfield') : null;
    let kind = initialBundle ? 'bundle' : requestedKind;
    let label = initialBundle || (isCombined ? 'Combined' : names[index]);
    const graduationYear = isFaculty ? element('input') : null;
    if (graduationYear) {
      graduationYear.type = 'search';
      graduationYear.inputMode = 'numeric';
      graduationYear.maxLength = 4;
    }
    const activeGroup = kind==='bundle' ? 'Economics' : kind==='group' ? label : kind==='primary' ? groupFor(index) : null;
    const isEconomics = activeGroup==='Economics';
    if (researchCard && !isEconomics) {
      const notes=researchCard.querySelector('.demo-table-notes p');
      for (const node of notes.childNodes) if(node.nodeType===Node.TEXT_NODE) {
        node.textContent=node.textContent.replace(/Raw per capita divides by the selected unit’s faculty count\.\s*Bayes adds \d+ faculty with zero credits to that denominator\.\s*/,'');
      }
    }
    if (isCombined) (researchCard?.querySelector('#atlas-source-note') || control('source-note')).append(' Combined includes Finance, Accounting, Marketing, Management, and Operations & IS; Economics is excluded. Combined scores use Econ Atlas records and may differ from the separately curated finance rankings.');
    if (researchCard) {
      researchCard.dataset.unitLabel='schools';
      for (const node of researchCard.querySelector('.demo-table-notes p').childNodes) {
        if (node.nodeType===Node.TEXT_NODE) node.textContent=node.textContent.replace('Departments must have at least five faculty','Universities must have at least five faculty');
      }
    }
    const combinedFields = ['Finance','Accounting','Marketing','Management','Operations & IS'];
    const combinedCore = new Set(combinedFields.flatMap(field=>data.journalSets[field]?.core || []));
    const combinedExpanded = new Set(combinedFields.flatMap(field=>data.journalSets[field]?.expanded || data.journalSets[field]?.core || []));
    const selectedSets = isCombined ? {core:[...combinedCore],expanded:[...combinedExpanded]} : (data.journalSets[activeGroup] || {});
    const journalSets = {
      leading: new Set(data.leading),
      ...Object.fromEntries(Object.entries(selectedSets)
        .map(([tier,ids])=>[tier,new Set(ids)]))
    };
    if (journalSets.core) {
      const core = journalSets.core.size;
      const shortCore = {Accounting:'TAR, JAE, JAR',Economics:'AER, ECTA, JPE, QJE, ReStud',Marketing:'JM, JMR, JCR, MktSci',Management:'Management A journals','Operations & IS':'MS, OR, MISQ, ISR'};
      if (activeGroup==='Management' && journalSets.tight) option(journals,'tight','AMJ, AMR, ASQ, OS, SMJ');
      option(journals,'core',isCombined ? 'Core journals' : shortCore[activeGroup] || `Top ${core}`);
      journals.disabled = !journalSets.expanded;
      if (journalSets.expanded) {
        const extra = 'other top';
        const coreLabel = isCombined ? 'Core journals' : activeGroup === 'Management' ? shortCore.Management : `Top ${core}`;
        option(journals,'expanded',activeGroup==='Management' ? `${coreLabel} + 0.5 × A− journals` : `${coreLabel} + 0.5 × ${extra}`);
        journals.value = 'expanded';
      }
    } else {
      option(journals,'all','all indexed journals');
      option(journals,'leading','Econ Atlas leading journals');
    }
    journalSets.core ??= new Set();
    journalSets.custom = new Set(journalSets.core.size ? journalSets.core : (journalSets[journals.value] || data.journals.map((_,id)=>id)));
    option(journals,'custom','Custom journals');
    const editor=element('div',null,'tenure-peer-editor journal-custom-editor'); editor.hidden=true;
    const journalInputLabel=element('label','Add:');
    const input=element('input'); input.type='search'; input.setAttribute('list','custom-journal-options'); input.setAttribute('aria-label','Add a journal');
    input.autocomplete='off'; input.placeholder='Search journals';
    const list=element('datalist'); list.id='custom-journal-options';
    const journalPriority = id => journalSets.core.has(id) ? 0 : journalSets.expanded?.has(id) ? 1 : 2;
    data.journals.map((name,id)=>({name,id})).sort((a,b)=>
      journalPriority(a.id)-journalPriority(b.id) || a.name.localeCompare(b.name)
    ).forEach(({name})=>{ const item=element('option'); item.value=name; list.append(item); });
    window.JournalLabels.attach(input,list);
    const chips=element('div',null,'journal-custom-chips');
    const current=element('div',null,'journal-custom-current');
    current.append(element('strong','Current:'),chips);
    journalInputLabel.append(input); editor.append(journalInputLabel,list,current);
    (journals.closest('.demo-controls') || options).after(editor);
    function renderCustom() {
      window.JournalLabels.update(list,name=>journalSets.custom.has(data.journals.indexOf(name)));
      chips.replaceChildren();
      for(const id of [...journalSets.custom].sort((a,b)=>data.journals[a].localeCompare(data.journals[b]))) {
        const chip=element('button',`${data.journals[id]} ×`,'secondary-button'); chip.type='button';
        chip.setAttribute('aria-label',`Remove ${data.journals[id]}`);
        chip.disabled=journalSets.custom.size===1;
        if(chip.disabled) chip.title='At least one journal is required';
        chip.addEventListener('click',()=>{if(journalSets.custom.size<=1)return;journalSets.custom.delete(id); renderCustom(); refreshCustom();});
        chips.append(chip);
      }
    }
    if(researchCard && params.get('table')===researchCard.id){
      const sharedFilter=params.get('filter');
      if([...journals.options].some(option=>option.value===sharedFilter)) journals.value=sharedFilter;
      if(journals.value==='custom'){
        const ids=params.getAll('journal').map(name=>data.journals.indexOf(name)).filter(id=>id>=0);
        if(ids.length) journalSets.custom=new Set(ids);
        editor.hidden=false;
        renderCustom();
      }
    }
    function refreshCustom() {
      cache=null; showJournalList();
      if (isTenure) redrawTenureSelection(); else if (researchCard && refreshResearch) refreshResearch(); else update();
    }
    function addJournal() {
      const id=data.journals.findIndex(name=>name.toLocaleLowerCase()===input.value.trim().toLocaleLowerCase());
      if(id<0)return false;
      input.setCustomValidity(''); journalSets.custom.add(id); input.value=''; renderCustom(); refreshCustom();
      return true;
    }
    input.addEventListener('input',()=>{input.setCustomValidity('');addJournal();});
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(!addJournal()){input.setCustomValidity('Choose a journal from the suggestions.');input.reportValidity();}}});
    journals.addEventListener('change',()=>{editor.hidden=journals.value!=='custom';if(!editor.hidden){renderCustom();input.focus();}});
    function showJournalList() {
      const ids = journalSets[journals.value] || new Set(data.journals.map((_,id)=>id));
      const labels = ids => [...ids].map(id=>window.JournalLabels.short(data.journals[id])).join(', ');
      const core=[...ids].filter(id=>journals.value!=='expanded' || journalSets.core.has(id));
      const other=[...ids].filter(id=>journals.value==='expanded' && !journalSets.core.has(id));
      journalList.textContent = `${isTenure ? 'Included journals' : 'Journals'}: ${labels(core)}${other.length ? `; ${isTenure ? 'plus 0.5 credit for' : 'half credit:'} ${labels(other)}` : ''}.`;
    }
    showJournalList();
    journals.addEventListener('change',showJournalList);
    const people = data.people.map(([name,unit,fields,tags,program,phd,year,source,programId,reportedProgram,programAlias,rank,profile,cv],id) =>
      ({id,name,unit,fields,tags,program,phd,year,source,programId,reportedProgram,programAlias,rank,profile,cv,group:groupFor(fields[0]),school:units[unit][0]}));
    if(isTenure) {
      for(const since of [2020,2015,2010]) option(cutoff,since-1,since);
      cutoff.value='2014';
    } else {
      for (const year of data.cutoffs) {
        if (view==='phd' && end-year>20) continue;
        option(cutoff,year,view==='phd' ? `${end-year} years` : year);
      }
      cutoff.value = '2015';
    }
    first.max = last.max = last.value = end+1;
    options.hidden = false;

    let members, selected, rows = [], scores, research = [], refreshResearch;
    const expanded = new Set();
    let cache;
    const credits = id => scores[id]?.reduce((total,value) => total+value,0) ?? null;
    const average = values => values.reduce((a,b) => a+b,0) / values.length;
    const byName = (a,b) => a.label.localeCompare(b.label);
    const countryCodes = new Map([['Czech Republic','CZ'],['Germany','DE'],['Turkey','TR'],['United Kingdom','GB'],['Hong Kong','HK'],['Taiwan','TW'],['South Korea','KR'],['Russia','RU']]);
    if (researchCard || isPhd || isFaculty) {
      const regions = new Intl.DisplayNames('en',{type:'region',fallback:'none'});
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      for (const first of alphabet) for (const last of alphabet) {
        const code = first+last, country = regions.of(code);
        if (country && !countryCodes.has(country)) countryCodes.set(country,code);
      }
    }

    function navigation() {
      const field = isEconomics ? 'Economics' : label;
      const fieldInSentence = field === 'Operations & IS' ? 'operations & IS' : field.toLowerCase();
      const heading = researchCard ? (isCombined ? 'Universities ranked by combined publication counts' : `Universities ranked by ${fieldInSentence} publication counts`) : `${field} ${isPhd?title:title.toLowerCase()}`;
      const headingNode = researchCard?.querySelector('.ranking-card-title') || control('title');
      headingNode.textContent = heading;
      const attribution = element('a','econ-faculty.github.io data');
      attribution.href = 'https://econ-faculty.github.io/';
      attribution.className = 'ranking-title-source';
      headingNode.append(' (', attribution, ')');
      if (researchCard) researchCard.querySelector('caption').textContent =
        `${heading}. Expand a row to inspect the sampled faculty and top authors.`;
      if (isFaculty) table.caption.textContent = `${heading}.`;
      document.title = researchCard
        ? document.querySelector('.research-page-heading h1')?.textContent || heading
        : heading;
      for (const link of siteViews) link.href = fieldURL(link.dataset.siteView,label,kind);
      for (const link of mainFields) {
        if (link.dataset.navField===activeGroup) link.setAttribute('aria-current','location');
        else link.removeAttribute('aria-current');
      }
    }

    function updateField() {
      members = people.filter(person => isCombined ? combinedFields.includes(person.group) : person.group!=='Finance' && (!isEconomics || person.group==='Economics') && (
        (kind==='group' && person.group===label)
        || (kind==='bundle' && economicsBundles[label][1].some(name=>person.fields.includes(primary.indexOf(`Economics: ${name}`))))
        || (kind==='primary' && person.fields.includes(index))
        || (kind==='tag' && person.tags.includes(index))));
      selected = new Set(members.map(person=>person.id));
      cache = null;
      if (isTenure) updateTenureSchools();
      if (isFaculty) {
        window.SchoolFilter.suggest(program,members.map(facultyProgramFields));
        window.SchoolFilter.suggest(currentSchool,members.map(person=>({name:units[person.unit]?.[0],country:units[person.unit]?.[3],region:units[person.unit]?.[4]})));
      }
      navigation();
      if (researchCard) {
        if (refreshResearch) refreshResearch();
        else {
          refreshResearch = window.mountResearchExplorer(researchCard,researchData,data.priorFaculty,{atlas:true,showPerCapita:isEconomics,
            getCustomJournals:()=>[...journalSets.custom].map(id=>data.journals[id])});
          root.replaceWith(researchCard);
        }
      } else update();
    }

    if (isEconomics && !regionalEconomics) {
      const subfield = element('select');
      subfield.setAttribute('aria-label','Economics subfield');
      option(subfield,'','All Economics');
      for (const [id,[name]] of Object.entries(economicsBundles)) option(subfield,`bundle:${id}`,name);
      subfield.value = kind==='bundle' ? `bundle:${label}` : kind==='primary' ? label : '';
      const selector = element('label','Subfield');
      selector.className = 'atlas-subfield-control';
      selector.append(subfield);
      if (isTenure) control('school-form').append(selector);
      else (researchCard?.querySelector('[role="group"]') || options).prepend(selector);
      subfield.addEventListener('change',()=>{
        kind = subfield.value.startsWith('bundle:') ? 'bundle' : subfield.value ? 'primary' : 'group';
        label = kind==='bundle' ? subfield.value.slice(7) : subfield.value || 'Economics';
        index = (kind==='primary' ? primary : groups).indexOf(label);
        history.replaceState(null,'',fieldURL(view,label,kind));
        expanded.clear();
        updateField();
      });
    }

    const journalCredit = (journal, selection) =>
      selection==='expanded' && !journalSets.core.has(journal) ? 0.5 : 1;

    function measure(after, weighting = 'sqrt', journalSet = journals.value) {
      const signature = [after,journalSet,weighting].join('/');
      if (cache?.signature===signature) return cache;
      const author = Array(people.length), employer = new Map();
      let paperCount = 0;
      const includedJournals = journalSets[journalSet];
      for (const [year,journal,authors,links] of papers) {
        if (year<=after || (includedJournals && !includedJournals.has(journal))) continue;
        const credit = journalCredit(journal,journalSet);
        const employers = view==='phd' ? new Set() : null;
        let linked = false;
        for (const id of links) {
          if (!selected.has(id)) continue;
          linked = true;
          author[id] ??= new Float64Array(end-after);
          author[id][year-after-1] += credit;
          employers?.add(groupUnit(people[id].unit));
        }
        if (linked) paperCount++;
        for (const unit of employers || []) employer.set(unit,(employer.get(unit) || 0)+credit);
      }
      cache = {signature,author,employer,paperCount};
      return cache;
    }

    const firstUnitBySchool = new Map();
    units.forEach(([school],id)=>{ if(!firstUnitBySchool.has(school)) firstUnitBySchool.set(school,id); });
    const groupUnit = id => (isCombined || researchCard || isTenure) ? firstUnitBySchool.get(units[id][0]) : id;
    function unitRosters() {
      const rosters = new Map();
      for (const person of members) {
        const unit=groupUnit(person.unit);
        if (!rosters.has(unit)) rosters.set(unit,[]);
        if (!rosters.get(unit).some(existing => existing.id===person.id)) rosters.get(unit).push(person);
      }
      return [...rosters];
    }

    function researchRows() {
      return unitRosters().filter(([,roster])=>roster.length>=window.TenureCharts.minimumPeerFaculty).map(([id,roster]) => {
        const [label] = units[id];
        const values = roster.map(person=>credits(person.id)).filter(value=>value!=null).sort((a,b)=>b-a);
        const total = values.length ? values.reduce((a,b)=>a+b,0) : null;
        return {label,raw:total==null?null:total/roster.length,top:total==null?null:values.slice(0,4).reduce((a,b)=>a+b,0)};
      });
    }

    function researchData() {
      const groups = Object.create(null), schools = [], eligibleUnits = [], largestUnits = [];
      for (const [id,roster] of unitRosters()) {
        const [school,originalUnit,alias,country,region] = units[id];
        const unit='';
        // Keep scores at university level, but show the recorded divisions in
        // the expanded roster. Merge obvious labels such as 'Economics' and
        // 'Department of Economics' without maintaining school-specific rules.
        const divisions = new Map();
        for (const person of roster) {
          const name = units[person.unit][1] || 'Faculty';
          const key = name.trim().replace(/^department of\s+/i,'').toLocaleLowerCase();
          if (!divisions.has(key)) divisions.set(key,{name,members:[]});
          const division = divisions.get(key);
          if (/^department of\s+/i.test(name)) division.name = name;
          division.members.push(person.name);
        }
        const largest = [...divisions.values()].sort((a,b) => b.members.length-a.members.length || a.name.localeCompare(b.name))[0];
        largestUnits.push(largest);
        groups[school] = [...divisions.values()].map(({name,members}) =>
          [name,true,members.sort((a,b)=>a.localeCompare(b))]);
        eligibleUnits.push(roster);
        schools.push([school,roster.length,null,unit,countryCodes.get(country),country,alias,region]);
      }
      function getWindow(filter,after) {
        const {author,paperCount} = measure(after,'sqrt',filter);
        const coverage = [], scores = [];
        for (const [unitIndex,roster] of eligibleUnits.entries()) {
          const credited = roster.filter(person=>author[person.id]).map(person=>
            [person.id,author[person.id].reduce((total,value)=>total+value,0)]);
          credited.sort((a,b)=>b[1]-a[1] || people[a[0]].name.localeCompare(people[b[0]].name));
          const top = credited.slice(0,4);
          coverage.push([null,null,credited.length]);
          const largest = largestUnits[unitIndex];
          const largestNames = new Set(largest?.members || []);
          const largestTotal = credited.filter(([id])=>largestNames.has(people[id].name)).reduce((sum,[,credit])=>sum+credit,0);
          scores.push(credited.length
            ? [credited.reduce((total,[,credit])=>total+credit,0),top.reduce((total,[,credit])=>total+credit,0),top,[largestTotal,largestNames.size,largest?.name || '']]
            : [null,null,[]]);
        }
        return [paperCount,null,coverage,scores];
      }
      return [{schools,authors:people.map(person=>person.name),originalSchoolCount:schools.length,getWindow},groups];
    }

    function graduateRows(after, employers) {
      const programs = new Map();
      for (const person of members) {
        if (!person.program || !person.phd || person.phd<Number(first.value) || person.phd>Number(last.value)) continue;
        const id = person.programId ?? person.program;
        if (!programs.has(id)) {
          const [country,region,city,short] = data.geography?.[id] || [];
          programs.set(id,{label:person.program,programId:id,alias:person.programAlias,country,region,city,short,verifiedUniversity:!!data.geography?.[id],count:0,credits:null,current:null,roster:[]});
        }
        const row = programs.get(id);
        const from = Math.max(person.phd,after+1);
        const record = scores[person.id];
        const rate = record && from<=end
          ? record.slice(from-after-1).reduce((a,b)=>a+b,0)/(end-from+1) : null;
        const unit=groupUnit(person.unit);
        const employerRate = employers.has(unit) ? employers.get(unit)/(end-after) : null;
        row.count++;
        if (rate!=null) row.credits = (row.credits ?? 0)+rate;
        if (employerRate!=null) row.current = (row.current ?? 0)+employerRate;
        row.roster.push({...person,rate,employerRate});
      }
      return [...programs.values()];
    }

    let historyKey;
    function drawPhdHistory() {
      if (!isPhd) return;
      const key = `${kind}:${label}`;
      if (key===historyKey) return;
      const template=document.querySelector('#atlas-history-template');
      if (!template) return;
      historyKey=key;
      const after=end-10, employer=measure(after,'sqrt','core').employer;
      const annual=new Map();
      for (const person of members) {
        if (!person.program || !Number.isInteger(person.phd) || !employer.has(groupUnit(person.unit))) continue;
        const id=person.programId ?? person.program;
        if (!annual.has(id)) annual.set(id,{id:String(id).replace(/-/g,'_'),name:data.geography?.[id]?.[3] || person.program,fullName:person.program,years:new Map()});
        const school=annual.get(id);
        school.years.set(person.phd,(school.years.get(person.phd) || 0)+employer.get(groupUnit(person.unit))/10);
      }
      const schools=[...annual.values()];
      const sum=(school,start,finish)=>[...school.years].reduce((value,[year,score])=>value+(year>=start && year<=finish?score:0),0);
      const ordered=(start,finish)=>schools.map(school=>({school,score:sum(school,start,finish)})).filter(row=>row.score>0)
        .sort((a,b)=>b.score-a.score || a.school.fullName.localeCompare(b.school.fullName));
      const firstYear=Math.min(...schools.flatMap(school=>[...school.years.keys()]));
      const periods=[1980,1990,2000,2010,2020].map(start=>{
        const finish=Math.min(start+9,end+1), rows=ordered(start,finish), total=rows.reduce((value,row)=>value+row.score,0);
        const ranked=[];
        for(let i=0;i<rows.length;) {
          let endIndex=i+1;
          while(endIndex<rows.length && Math.abs(rows[endIndex].score-rows[i].score)<=1e-12) endIndex++;
          const tied=rows.slice(i,endIndex); let tieStart=start, tieFinish=finish;
          if(tied.length>1) do {
            tieStart--; for(const row of tied) row.tieScore=sum(row.school,tieStart,finish);
            tied.sort((a,b)=>b.tieScore-a.tieScore || a.school.fullName.localeCompare(b.school.fullName));
          } while(tieStart>firstYear && tied.some((row,j)=>j && Math.abs(row.tieScore-tied[j-1].tieScore)<=1e-12));
          if(tied.length>1) while(tieFinish<end+1 && tied.some((row,j)=>j && Math.abs(row.tieScore-tied[j-1].tieScore)<=1e-12)) {
            tieFinish++; for(const row of tied) row.tieScore=sum(row.school,tieStart,tieFinish);
            tied.sort((a,b)=>b.tieScore-a.tieScore || a.school.fullName.localeCompare(b.school.fullName));
          }
          let rank=i+1;
          tied.forEach((row,j)=>{
            if(j && Math.abs(row.tieScore-tied[j-1].tieScore)>1e-12) rank=i+j+1;
            if(rank<=10) ranked.push({id:row.school.id,name:row.school.name,fullName:row.school.fullName,score:row.score,rank,share:total?100*row.score/total:0,...(tied.length>1?{tieBreak:{start:tieStart,end:tieFinish,score:row.tieScore}}:{})});
          });
          i=endIndex;
        }
        return {label:`${start}–${finish}`,start,end:finish,total,top:ranked};
      });
      const palette=['#7652ae','#1878a5','#b42335','#1c8268','#ae6b18','#4d62ce','#c0477d','#008c8b'];
      const chartSchools=[...new Map(periods.flatMap(period=>period.top).map(row=>[row.id,row])).values()].map((row,i)=>({id:row.id,name:row.name,fullName:row.fullName,color:palette[i%palette.length],abbreviation:row.name.split(/\s+/).map(word=>word[0]).join('').slice(0,4).toUpperCase()}));
      const bands=[{name:'Top 5',color:'#b42335'},{name:'Top 10',color:'#1878a5'},{name:'Top 20',color:'#1c8268'},{name:'Top 40',color:'#7652ae'},{name:'Any scored placements',color:'#c28127'},{name:'No scored placements',color:'#788491'}];
      const windows=[];
      for(let year=1995;year<=end+1;year++) {
        const prior=ordered(year-14,year-5), ranks=new Map(); let rank=0,previous=null;
        prior.forEach((row,i)=>{if(previous===null || Math.abs(previous-row.score)>1e-12) rank=i+1; previous=row.score; ranks.set(row.school.id,rank);});
        const values=bands.map(()=>0);
        for(const school of schools){const r=ranks.get(school.id),band=r==null?5:r<=5?0:r<=10?1:r<=20?2:r<=40?3:4;values[band]+=sum(school,year-4,year);}
        const total=values.reduce((a,b)=>a+b,0);
        windows.push({year,start:year-4,end:year,priorDecade:`${year-14}–${year-5}`,total,scores:values,shares:values.map(value=>total?100*value/total:0)});
      }
      document.getElementById('atlas-phd-history')?.remove();
      document.getElementById('decade-data')?.remove(); document.getElementById('previous-data')?.remove();
      const fragment=template.content.cloneNode(true), section=fragment.querySelector('.history-figures');
      section.id='atlas-phd-history';
      const sourceName=activeGroup==='Economics' && kind==='bundle' ? economicsBundles[label][0] : activeGroup;
      for(const [selector,title] of [['#decade-heading',`Where top ${sourceName} faculty earned their PhDs, by graduation decade`],['#inequality-heading',`Where top ${sourceName} faculty earned their PhDs, by historical program rank`]]) {
        const heading=section.querySelector(selector); heading.textContent=title+' (';
        const link=element('a','econ-faculty.github.io data','ranking-title-source');link.href='https://econ-faculty.github.io/';heading.append(link,')');
      }
      section.querySelector('#decade-title').textContent=`Where top ${sourceName} faculty earned their PhDs, by graduation decade`;
      section.querySelector('#previous-title').textContent=`Where top ${sourceName} faculty earned their PhDs, by historical program rank`;
      for(const [id,description] of [['decade-chart','graduation decade'],['previous-chart','historical program rank']]) {
        const button=section.querySelector(`[data-download-chart="${id}"]`);
        button.title=button.ariaLabel=`Download ${sourceName} PhD rankings by ${description} as PNG`;
        button.dataset.downloadName=`${sourceName.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-phd-${id}.png`;
      }
      const note=`Scores use current employers’ ${sourceName} core-journal publication credits for ${after+1}–${end}, divided by 10. Each faculty author receives full journal credit. Coverage follows Econ Atlas; self-placements are not capped. Ties use earlier, then later graduation years if needed; hover over a point for the years used.`;
      section.querySelectorAll('.history-figure > .demo-note').forEach(node=>node.textContent=note);
      const captions=section.querySelectorAll('.caption-copy');
      if(captions[0]) captions[0].textContent='Figure 1. Doctoral programs ranked by current-employer publication scores, grouped by graduation decade. Econ Atlas data.';
      if(captions[1]) captions[1].textContent='Figure 2. Five-year placement-score shares grouped by program rank in the preceding ten years. Econ Atlas data.';
      for(const figure of section.querySelectorAll('figure')) for(const link of figure.querySelectorAll('a.caption-icon')) {
        const destination=new URL(link.href), shared=new URL(location.href); shared.hash=figure.id;
        destination.searchParams.set('url',shared.href);
        if(destination.hostname==='twitter.com') destination.searchParams.set('text',figure.querySelector('h2').textContent);
        link.href=destination.href;
      }
      root.after(fragment);
      for(const [id,value] of [['decade-data',{periods,schools:chartSchools}],['previous-data',{years:windows.map(window=>window.year),bands,windows}]]) {
        const script=element('script');script.type='application/json';script.id=id;script.textContent=JSON.stringify(value);document.body.append(script);
      }
      const runtime=element('script'); runtime.src='/rankings/history-charts.js'; document.body.append(runtime);
    }

    const schoolGeography = new Map(units.map(([name,,,country,region])=>[name,{country,region}]));
    const shortNames = new Map(units.filter(([, ,short])=>short).map(([name,,short])=>[name,short]));
    const tenurePapersByAuthor = new Map();
    const renderCaseTable = isTenure ? window.TenureCharts.caseTable(root.querySelector('[data-tenure-cases]')) : null;
    if (isTenure) {
      for (const [title,year,journal,link,links] of data.tenurePapers) {
        for (const id of links) {
          if (!tenurePapersByAuthor.has(id)) tenurePapersByAuthor.set(id,[]);
          tenurePapersByAuthor.get(id).push({title,year,journal,link});
        }
      }
    }
    let caseMembers = [], tenureSchools = [], peerSchools = [];
    const tenureFocusKey = `tenure-focus:${requestedName}`;
    const sharedTenureKey = 'tenure-selection:shared';
    const readSharedTenure = () => { try { return JSON.parse(localStorage.getItem(sharedTenureKey) || 'null'); } catch { return null; } };
    const sharedTenure = root.dataset.snapshotSchool ? {focus:root.dataset.snapshotSchool,mode:'auto25'} :
      isTenure ? readSharedTenure() : null;
    const readTenureFocus = () => { try { return localStorage.getItem(tenureFocusKey) || ''; } catch { return ''; } };
    const saveTenureFocus = name => { try { localStorage.setItem(tenureFocusKey,name); } catch {} };
    let focus = isTenure ? sharedTenure?.focus || readTenureFocus() : '';
    let peerMode = ['auto25','custom'].includes(sharedTenure?.mode) ? sharedTenure.mode : 'auto25';
    let manualPeers = peerMode==='custom' && Array.isArray(sharedTenure?.peers) ? [...sharedTenure.peers] : null, activePeers = [];

    function updateTenureSchools() {
      caseMembers = members.filter(({year,phd})=>year && phd>data.cutoffs[0] && year-phd>=6 && year-phd<=11);
      const schools = new Set(caseMembers.map(person=>person.school));
      for (const [id,,year] of data.tenureCandidates) {
        if (selected.has(id) && isPotentialCase(people[id].phd,year,data.cutoffs[0])) schools.add(people[id].school);
      }
      tenureSchools = [...schools].sort((a,b)=>a.localeCompare(b));
      peerSchools = [...new Set([...tenureSchools,...members.map(person=>person.school)])];
      updateFocalSuggestions();
      if (!tenureSchools.includes(focus)) {
        const equivalent=tenureSchools.find(name=>window.SchoolFilter.aliases(name).some(alias=>normalize(alias)===normalize(focus)));
        focus=equivalent || focus;
      }
      school.value = focus;
      if (peerMode!=='custom') manualPeers = null;
    }

    function updateFocalSuggestions() {
      const schoolScores = new Map();
      for (const row of research) if (row.raw != null) {
        const scores = schoolScores.get(row.label) || [];
        scores.push(row.raw); schoolScores.set(row.label,scores);
      }
      const ordered = [...schoolScores].sort((a,b)=>average(b[1])-average(a[1]));
      const ranks = new Map(ordered.map(([name],index)=>[name,index]));
      const options = (names,peers=false)=>names.map(name=>({name,aliases:[shortNames.get(name)],
        ...schoolGeography.get(name),rank:peers ? Math.abs((ranks.get(name) ?? Infinity)-(ranks.get(focus) ?? Infinity)) : ranks.get(name)}));
      window.SchoolFilter.suggest(school,options(tenureSchools),{schoolsOnly:true,ranked:true,currentSchool:()=>focus});
      window.SchoolFilter.suggest(control('add-school'),options(peerSchools,true),{schoolsOnly:true,ranked:true,exclude:item=>item.name===focus,marked:item=>activePeers.includes(item.name)});
    }

    function isPotentialCase(phd,year,after) {
      return year ? year>after : !phd || phd+11>after;
    }

    function configureTenure() {
      const input = control('add-school'), list = control('peer-list'), mode = control('peer-mode');
      const feedback = control('peer-message');
      mode.value=peerMode;
      function match(value, eligible = tenureSchools) {
        const term = normalize(value).trim();
        const matches = eligible.filter(name=>[name,shortNames.get(name),...window.SchoolFilter.aliases(name)].some(alias=>normalize(alias || '')===term));
        return term && matches.length===1 ? matches[0] : '';
      }
      mode.addEventListener('change',()=>{
        peerMode=mode.value;
        manualPeers=peerMode==='custom' ? [...activePeers] : null;
        notify(''); update();
      });
      function notify(text) {
        feedback.textContent = text;
        feedback.classList.toggle('sr-only',!text);
      }
      function setFocus(name,commit = true) {
        if (commit) school.value = name;
        notify('');
        if (focus===name) return;
        focus = name;
        saveTenureFocus(name);
        if (manualPeers) manualPeers = manualPeers.filter(peer=>peer!==name);
        if (peerMode!=='custom') manualPeers = null;
        update();
      }
      school.addEventListener('input',event=>{
        if (event.isComposing) return;
        const name = match(school.value);
        if (name) setFocus(name,false);
      });
      school.addEventListener('change',()=>{
        const name = match(school.value);
        if (name) setFocus(name);
      });
      control('school-form').addEventListener('submit',event=>{
        event.preventDefault();
        const name = match(school.value);
        if (name) setFocus(name);
        else notify('Choose a focal school from the suggestions.');
      });
      control('add-form').addEventListener('submit',event=>{
        event.preventDefault();
        const name = match(input.value,peerSchools);
        if (!name) { notify('Choose a peer school from the suggestions.'); return; }
        if (name===focus || activePeers.includes(name)) { notify(name+' is already included.'); return; }
        manualPeers = [...activePeers,name];
        peerMode=mode.value='custom';
        input.value = '';
        notify('Added '+name+'.');
        update();
      });
      list.addEventListener('click',event=>{
        const button = event.target.closest('[data-remove-peer]');
        if (!button) return;
        const name = button.dataset.removePeer;
        const index = [...list.children].indexOf(button.parentElement);
        manualPeers = activePeers.filter(peer=>peer!==name);
        peerMode=mode.value='custom';
        notify('Removed '+name+'.');
        update();
        (list.children[Math.min(index,list.children.length-1)]?.firstElementChild || input).focus();
      });
    }

    function tenureRows(after) {
      const cases = caseMembers.filter(person=>person.year>after);
      if (!focus && tenureSchools.length) {
        const scores = new Map();
        for (const row of research) if (row.raw!=null) {
          const values=scores.get(row.label) || []; values.push(row.raw); scores.set(row.label,values);
        }
        const ranked=[...scores].sort((a,b)=>average(b[1])-average(a[1])).map(([name])=>name);
        const included=journalSets[journals.value];
        const counts=new Map();
        for (const person of cases) {
          if (!(tenurePapersByAuthor.get(person.id) || []).some(paper=>paper.year>=person.year-10 && paper.year<=person.year && (!included || included.has(paper.journal)))) continue;
          counts.set(person.school,(counts.get(person.school) || 0)+1);
        }
        const eligible=name=>(counts.get(name) || 0)>=2;
        const candidates=ranked.slice(19,50).filter(eligible);
        const fallback=ranked.filter(eligible);
        const pool=candidates.length ? candidates : fallback;
        focus = pool.length ? pool[Math.floor(Math.random()*pool.length)] : cases[0]?.school || tenureSchools[0];
        school.value = focus;
        saveTenureFocus(focus);
      }
      const counts = new Map();
      for (const row of research) {
        if (row.raw==null) continue;
        if (!counts.has(row.label)) counts.set(row.label,[]);
        counts.get(row.label).push(row);
      }
      const profile = name => {
        const rows = counts.get(name);
        return rows ? [average(rows.map(row=>row.raw)),average(rows.map(row=>row.top))] : null;
      };
      const focalProfile = profile(focus);
      const distance = name => {
        const other = profile(name);
        return focalProfile && other ? Math.hypot(...focalProfile.map((value,i)=>Math.log1p(value)-Math.log1p(other[i]))) : Infinity;
      };
      const caseSchools = new Set(cases.map(person=>person.school));
      const choices = focalProfile ? [...caseSchools].filter(name=>name!==focus && counts.has(name)) : [];
      const included=journalSets[journals.value];
      const plottedCounts=new Map();
      for (const person of cases) {
        if (!(tenurePapersByAuthor.get(person.id) || []).some(paper=>paper.year>=person.year-10 && paper.year<=person.year && (!included || included.has(paper.journal)))) continue;
        plottedCounts.set(person.school,(plottedCounts.get(person.school)||0)+1);
      }
      let total=0;
      const automatic=[];
      const nearest=choices.sort((a,b)=>distance(a)-distance(b)||a.localeCompare(b));
      const above=nearest.filter(name=>profile(name) && focalProfile && profile(name)[0]>focalProfile[0]);
      const below=nearest.filter(name=>!profile(name) || !focalProfile || profile(name)[0]<=focalProfile[0]);
      const ordered=[];
      while(above.length || below.length) {
        if(above.length) ordered.push(above.shift());
        if(below.length) ordered.push(below.shift());
      }
      for (const name of ordered) {
        if (total >= 25) break;
        const count=plottedCounts.get(name)||0;
        if (count) { automatic.push(name); total+=count; }
      }
      activePeers = (manualPeers ?? automatic).filter(name=>name!==focus);
      if (peerMode==='custom' && manualPeers) manualPeers=activePeers;
      try { localStorage.setItem(sharedTenureKey,JSON.stringify({focus,mode:peerMode,peers:activePeers})); } catch {}
      let coverageNote=control('peer-coverage');
      if (!coverageNote) {
        coverageNote=element('p');
        coverageNote.id='atlas-peer-coverage';
        control('peer-list').parentElement.after(coverageNote);
      }
      coverageNote.hidden=peerMode!=='auto25' || !!focalProfile;
      if (!coverageNote.hidden) {
        const sampled=members.filter(person=>person.school===focus).length;
        coverageNote.textContent=sampled<window.TenureCharts.minimumPeerFaculty
          ? `Automatic peers require at least ${window.TenureCharts.minimumPeerFaculty} sampled faculty. ${focus} has ${sampled} in this field selection. Add peer schools manually.`
          : `No publication score is available for ${focus} in this field selection. Add peer schools manually.`;
      }
      const peers = activePeers.toSorted((a,b)=>a.localeCompare(b));
      control('peer-list').replaceChildren(...peers.map(name=>{
        const availability = caseSchools.has(name) ? '' : ' (no tenure cases in this window)';
        const item = element('li'), button = element('button',name+availability+' ×');
        button.className = 'secondary-button peer-chip';
        button.type = 'button';
        button.dataset.removePeer = name;
        button.setAttribute('aria-label','Remove '+name);
        item.append(button);
        return item;
      }));
      const schools = new Set([focus,...peers]);
      return cases.filter(person=>schools.has(person.school));
    }

    function openTenureCase(row,trigger) {
      const detail = control('publication-content');
      const heading = element('h4',row.name);
      const summary = element('p',`${row.school} · PhD ${row.phd} · Promotion in ${row.year} · Career year ${row.age}`);
      detail.replaceChildren(heading,summary);
      if (/^https?:\/\//i.test(row.source || '')) {
        const source = element('a','Faculty source');
        source.href = row.source;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        detail.append(source);
      }
      if (row.papers.length) {
        const list = element('ul');
        for (const paper of row.papers.toSorted((a,b)=>b.year-a.year||a.title.localeCompare(b.title))) {
          const item = element('li');
          const url = /^https?:\/\//i.test(paper.link || '') ? paper.link
            : /^10\.\S+\/\S+$/.test(paper.link || '') ? 'https://doi.org/'+encodeURI(paper.link) : '';
          if (url) {
            const link = element('a',paper.title);
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            item.append(link);
          } else item.append(paper.title);
          item.append(element('small',`${data.journals[paper.journal]} · ${paper.year} · ${paper.credit} credit`));
          list.append(item);
        }
        detail.append(list);
      } else detail.append(element('p','No qualifying articles are recorded for these years.'));
      const dialog = control('publication-dialog');
      dialog.addEventListener('close',()=>trigger.focus(),{once:true});
      dialog.showModal();
    }

    function redrawTenureSelection() {
      const after=Number(cutoff.value);
      const schools=new Set([focus,...activePeers]);
      drawTenureChart(caseMembers.filter(person=>person.year>after && schools.has(person.school)),after);
    }

    function drawTenureChart(cases,after) {
      const selection = journals.value;
      const included = journalSets[selection];
      const qualifyingPapers = id => (tenurePapersByAuthor.get(id) || [])
        .filter(paper=>!included || included.has(paper.journal));
      const points = cases.flatMap(row=>{
        const eligible = qualifyingPapers(row.id).filter(paper=>paper.year>=row.year-10).map(paper=>({...paper,credit:journalCredit(paper.journal,selection)}));
        const papers = eligible.filter(paper=>paper.year<=row.year);
        if (!papers.length) return [];
        const credits = papers.reduce((sum,paper)=>sum+paper.credit,0);
        const nextYearCredits = eligible.filter(paper=>paper.year===row.year+1).reduce((sum,paper)=>sum+paper.credit,0);
        return [{...row,papers,credits,nextYearCredits,age:row.year-row.phd}];
      });
      const journalLabel = journals.selectedOptions[0].textContent;
      control('chart-title').textContent = 'Publications up to promotion year';
      root.querySelectorAll('.tenure-chart-key i[class^=percentile-]').forEach(icon=>{icon.parentElement.hidden=document.getElementById('atlas-year-adjustment').value==='off';});
      control('publication-plot').replaceChildren(window.TenureCharts.publicationChart(points,{
        xLabel:'Publications up to promotion year',focus,openCase:openTenureCase,yearAdjustment:document.getElementById('atlas-year-adjustment').value,
        dotRadius:isEconomics ? 3 : 4,
        emptyText:'No matching promotion cases have qualifying publications through promotion.'
      }));
      control('chart').hidden = false;
      coverage.textContent = `${format.format(points.length)} of ${format.format(cases.length)} dated promotion cases have qualifying publications through promotion.`;
      root.querySelectorAll('[data-focal-name]').forEach(label=>{label.textContent=focus;});
      const chosenSchools = new Set([focus,...activePeers]);
      const plotted = new Set(points.map(row=>row.id));
      const review = [];
      for (const [id,,year,cv,profile] of data.tenureCandidates) {
        const {name,school,phd} = people[id];
        const displayedPhd = phd, displayedYear = year;
        if (!selected.has(id) || !chosenSchools.has(school) || !isPotentialCase(displayedPhd,displayedYear,after)) continue;
        const eligible = qualifyingPapers(id).filter(paper=>paper.year>=displayedYear-10);
        if (!eligible.some(paper=>paper.year<=displayedYear)) continue;
        const displayedAge = displayedPhd && displayedYear ? displayedYear-displayedPhd : null;
        const timeline = eligible.map(paper=>({journal:data.journals[paper.journal],year:paper.year}));
        review.push({name,school,phd:displayedPhd,year:displayedYear,age:displayedAge,
          cv,profile,plotted:plotted.has(id),timeline,publicationEnd:null});
      }
      renderCaseTable(review,focus,activePeers);
      const subfield = isEconomics && kind==='bundle' ? `${economicsBundles[label][0]} · ` : isEconomics && kind==='primary' ? `${label} · ` : '';
      const adjustment=document.getElementById('atlas-year-adjustment').value;
      const method=adjustment==='off'?'hidden':adjustment==='none'?'vertical':adjustment==='minus5'?'set to zero five years before PhD':'set to zero at the PhD year';
      const peers=[...activePeers].sort((a,b)=>a.localeCompare(b));
      control('settings').textContent = `${subfield}${focus} and other schools’ promotion outcomes since ${after+1} (promotion to associate is a tenure proxy). Publications count the ten years before promotion through the promotion year; overlapping points are spread for visibility. Percentile guides are ${method}. Other schools: ${peers.join('; ') || 'none'}.`;
    }

    const programFields = row =>
      ({name:row.verifiedUniversity || data.programAliases?.[row.programId] ? row.label : '',
        aliases:data.programAliases?.[row.programId] ?? [row.alias],
        country:row.country,region:row.region,code:countryCodes.get(row.country)});

    const facultyProgramFields = person => {
      const [country,region] = data.geography?.[person.programId] || [];
      return {name:data.geography?.[person.programId] || data.programAliases?.[person.programId] ? person.program : '',
        aliases:data.programAliases?.[person.programId] ?? [person.programAlias], country, region, code:countryCodes.get(country)};
    };

    function update() {
      const after = Number(cutoff.value);
      if (isTenure) {
        scores = measure(2015,'sqrt','all').author;
        research = researchRows();
        updateFocalSuggestions();
        drawTenureChart(tenureRows(after),after);
        return;
      }
      const measured = measure(after);
      scores = measured.author;
      if (isPhd) {
        rows = graduateRows(after,measured.employer);
        window.SchoolFilter.suggest(search,rows.map(programFields));
        drawPhdHistory();
      } else rows = members.map(person=>({...person,label:person.name,unitId:person.unit,unit:units[person.unit][1],credits:credits(person.id)}));
      page = 0;
      draw();
    }

    function renderLabel(cell,row) {
      if (row.source && /^https?:\/\//i.test(row.source)) {
        const link = element('a',row.label);
        link.href = row.source;
        cell.append(link);
      } else cell.textContent = row.label;
    }

    function graduateDetail(row, collapse) {
      const detail = element('tr'), cell = detail.insertCell();
      detail.className = 'detail-row';
      cell.colSpan = columns.length+1;
      const panel = element('section');
      panel.className = 'detail-panel';
      panel.setAttribute('aria-label',`Graduates of ${row.label}`);
      const top = element('div'), introduction = element('div');
      top.className = 'detail-top';
      introduction.append(element('h3',`${row.label} · graduates`),
        element('p',`${format.format(row.count)} graduates · ${first.value}–${last.value}`));
      const close = element('button','Collapse −');
      close.className = 'detail-close';
      close.type = 'button';
      close.addEventListener('click',collapse);
      top.append(introduction,close);
      const scroll = element('div');
      scroll.className = 'detail-table-scroll';
      const graduates = element('table');
      graduates.className = 'graduates-table demo-graduates-table';
      const header = graduates.createTHead().insertRow();
      for (const title of ['Graduate','PhD year and reported institution','Pubs/year','Current affiliation','Pubs/year of current affiliation']) {
        const th = element('th',title);
        th.scope = 'col';
        header.append(th);
      }
      const roster = graduates.createTBody();
      for (const person of [...row.roster].sort((a,b)=>a.name.localeCompare(b.name))) {
        const tr = roster.insertRow();
        const name = tr.insertCell();
        name.textContent = person.name;
        if (person.source && /^https?:\/\//i.test(person.source)) {
          const source = element('a','+');
          source.className = 'evidence-button demo-graduate-source';
          source.href = person.source;
          source.target = '_blank';
          source.rel = 'noopener';
          source.setAttribute('aria-label',`Source for ${person.name}`);
          name.prepend(source,' ');
        }
        const unit = units[person.unit][1];
        const affiliation = [person.school,unit===person.school?'':unit].filter(Boolean).join(' · ');
        for (const value of [person.reportedProgram ? `${person.phd} · ${person.reportedProgram}` : person.phd,rateText(person.rate),affiliation,rateText(person.employerRate)]) {
          tr.insertCell().textContent = String(value);
        }
      }
      scroll.append(graduates);
      panel.append(top,scroll);
      cell.append(panel);
      return detail;
    }

    function addProgram(row,ranks) {
      const tr = body.insertRow();
      tr.className = 'program-row university-row';
      const rank = (ranks.get(sort) ?? ranks.get(defaultSort)).get(row);
      const rankCell = tr.insertCell();
      rankCell.className = 'rank-col frozen-rank';
      const rankNumber = element('span',rank==null?'—':rank);
      rankNumber.className = 'rank-number';
      if (rank!=null) {
        const prefix = element('sup','#');
        prefix.className = 'rank-prefix';
        rankNumber.prepend(prefix);
      }
      rankCell.append(rankNumber);
      const cell = tr.insertCell();
      cell.className = 'school-cell frozen-school';
      const button = element('button');
      button.type = 'button';
      button.className = 'school-button';
      button.setAttribute('aria-label',`Graduates of ${row.label}`);
      button.title = row.label;
      const caret = element('span'), name = element('span',row.short || row.label);
      caret.className = 'group-caret';
      caret.setAttribute('aria-hidden','true');
      name.className = 'school-name';
      button.append(caret,name);
      const code = countryCodes.get(row.country);
      if (code !== 'US' && /^[A-Z]{2}$/.test(code || '')) {
        const flag = element('span',String.fromCodePoint(...[...code].map(letter=>0x1F1E6+letter.charCodeAt(0)-65)),'research-country-flag');
        flag.setAttribute('role','img'); flag.setAttribute('aria-label',row.country);
        button.append(flag);
      }
      cell.append(button);
      const location = row.country === 'United States' ? row.city : [row.city,row.country].filter((part,index,all)=>part && all.indexOf(part)===index).join(', ');
      if (location) cell.append(element('span',location,'school-location'));
      for (const [key] of columns.slice(1)) {
        const td = tr.insertCell();
        td.className = key===sort ? 'score-cell active-score-column' : 'score-cell';
        const value = element('span',key==='count'?format.format(row.count):rateText(row[key]));
        value.className = 'score-number';
        td.append(value);
      }
      let detail;
      const showGraduates = () => {
        const open = expanded.has(row.label);
        button.setAttribute('aria-expanded',String(open));
        tr.classList.toggle('open',open);
        caret.textContent = open?'−':'+';
        if (open) {
          detail = graduateDetail(row,()=>{
            button.click();
            button.focus();
          });
          tr.after(detail);
        } else detail?.remove();
      };
      button.addEventListener('click',()=>{
        if (expanded.has(row.label)) expanded.delete(row.label);
        else expanded.add(row.label);
        showGraduates();
      });
      showGraduates();
    }

    function addFaculty(row,rank) {
      const tr = body.insertRow();
      tr.className = 'program-row';
      const rankCell = tr.insertCell();
      rankCell.className = 'rank-col frozen-rank';
      const rankNumber = element('span',rank ?? '—');
      rankNumber.className = 'rank-number';
      if (rank != null) {
        const prefix = element('sup','#');
        prefix.className = 'rank-prefix';
        rankNumber.prepend(prefix);
      }
      rankCell.append(rankNumber);
      const facultyCell = tr.insertCell();
      facultyCell.className = 'school-cell frozen-school';
      const button=element('button','+','group-caret faculty-expand');
      button.type='button'; button.setAttribute('aria-expanded','false'); button.setAttribute('aria-label',`Show details for ${row.label}`);
      facultyCell.append(button,' ',element('span',row.label,'faculty-name'));
      let detail;
      button.addEventListener('click',()=>{
        if (detail) { detail.remove(); detail=null; button.setAttribute('aria-expanded','false'); button.textContent='+'; return; }
        detail=element('tr',null,'detail-row'); const cell=detail.insertCell(); cell.colSpan=columns.length+1;
        const panel=element('section',null,'detail-panel faculty-detail'); panel.setAttribute('aria-label',`Details for ${row.label}`);
        panel.append(element('h3',row.label));
        const affiliation=[row.rank,row.unit,row.school].filter(Boolean).join(' · ');
        if (affiliation) panel.append(element('p',affiliation));
        panel.append(element('p',`PhD: ${row.program || 'Not recorded'}${row.phd ? ` (${row.phd})` : ''}`));
        const sources=element('p',null,'faculty-detail-links');
        for (const [label,url] of [['Profile',row.profile],['CV',row.cv || row.source]]) {
          if (!/^https?:\/\//i.test(url || '')) continue;
          const link=element('a',label); link.href=url; link.target='_blank'; link.rel='noopener noreferrer'; sources.append(link,' ');
        }
        if (sources.childNodes.length) panel.append(sources);
        const selectedJournals=journalSets[journals.value];
        const works=papers.filter(([year,journal,,ids])=>year>Number(cutoff.value) && (!selectedJournals || selectedJournals.has(journal)) && ids.includes(row.id))
          .sort((a,b)=>b[0]-a[0] || String(a[4] || '').localeCompare(String(b[4] || '')));
        panel.append(element('h4',`Recorded publications in the selected journals (${works.length})`));
        if (works.length) {
          const list=element('ul',null,'faculty-publications');
          for (const [year,journal,,,title,url] of works) {
            const item=element('li');
            if (/^https?:\/\//i.test(url || '')) { const link=element('a',title || 'Publication'); link.href=url; link.target='_blank'; link.rel='noopener noreferrer'; item.append(link); }
            else item.append(document.createTextNode(title || 'Publication'));
            item.append(` · ${data.journals[journal]} · ${year}`); list.append(item);
          }
          panel.append(list);
        } else panel.append(element('p','No matching publications recorded for the selected filters.'));
        cell.append(panel); tr.after(detail); button.setAttribute('aria-expanded','true'); button.textContent='−';
      });
      const schoolCell = tr.insertCell();
      schoolCell.className = 'faculty-school-cell';
      schoolCell.append(element('span',row.school,'faculty-school-name'));
      schoolCell.title = row.school;
      function addCountryFlag(cell,country) {
        const code=countryCodes.get(country);
        if (code === 'US' || !/^[A-Z]{2}$/.test(code || '')) return;
        const flag=element('span',String.fromCodePoint(...[...code].map(letter=>0x1F1E6+letter.charCodeAt(0)-65)),'faculty-country-flag');
        flag.setAttribute('role','img'); flag.setAttribute('aria-label',country); cell.append(' ',flag);
      }
      addCountryFlag(schoolCell,units[row.unitId]?.[3]);
      const programCell=tr.insertCell();
      programCell.className = 'faculty-school-cell';
      programCell.append(element('span',data.geography?.[row.programId]?.[3] || row.program?.split(' · ')[0] || '—','faculty-school-name'));
      programCell.title = row.program || '';
      addCountryFlag(programCell,data.geography?.[row.programId]?.[0]);
      for (const key of ['credits']) {
        const cell = tr.insertCell();
        cell.className = key===sort ? 'score-cell active-score-column' : 'score-cell';
        const value = row[key]==null ? '—' : creditFormat.format(row[key]);
        const score = element('span',value);
        score.className = 'score-number';
        cell.append(score);
        tr.insertBefore(cell,schoolCell);
      }
    }

    function draw() {
      const term = normalize(search.value).trim();
      const yearTerm = graduationYear?.value.trim() ?? '';
      const matches = rows.filter(row=>isPhd ? window.SchoolFilter.matches(programFields(row),term) :
        (!program.value.trim() || window.SchoolFilter.matches(facultyProgramFields(row),program.value)) &&
        (!currentSchool.value.trim() || window.SchoolFilter.matches({name:row.school,country:units[row.unitId]?.[3],region:units[row.unitId]?.[4]},currentSchool.value)) && String(row.phd ?? '').startsWith(yearTerm) &&
        term.split(/\s+/).every(word=>normalize([row.label,row.school,row.unit,row.alias,row.program,...window.SchoolFilter.aliases(row.school),...window.SchoolFilter.aliases(row.program)].filter(Boolean).join(' ')).includes(word)));
      const compare = (a,b) => {
        const av = a[sort], bv = b[sort];
        if (av==null || bv==null) return av===bv ? byName(a,b) : av==null ? 1 : -1;
        return bv-av || byName(a,b);
      };
      matches.sort(compare);
      const limit = Number(pageSize.value);
      const start = page*limit, visible = matches.slice(start,start+limit);
      const ranks = new Map();
      if (view!=='tenure') {
        for (const key of scoreColumns) {
          let lastScore, rank;
          const ordered = rows.filter(row=>row[key]!=null).sort((a,b)=>b[key]-a[key]);
          const metricRanks = new Map();
          ordered.forEach((row,i)=>{
            if (lastScore===undefined || Math.abs(lastScore-row[key])>1e-10) rank=i+1;
            lastScore = row[key];
            metricRanks.set(row,rank);
          });
          ranks.set(key,metricRanks);
        }
      }
      table.csvRows=()=>matches.map(row=>{
        if(isPhd) return [(ranks.get(sort) ?? ranks.get(defaultSort)).get(row) ?? '',row.label,
          row.count,row.credits ?? '',row.current ?? ''];
        if(isFaculty) return [ranks.get(defaultSort).get(row) ?? '',row.name,row.credits ?? '',row.school,row.program ?? ''];
        return columns.map(([key])=>row[key] ?? '');
      });
      for (const th of table.tHead.rows[0].cells) {
        const active = th.dataset.column===sort;
        if (active) th.setAttribute('aria-sort','descending');
        else th.removeAttribute('aria-sort');
        th.classList.toggle('active-score-column',active);
      }
      body.replaceChildren();
      for (const row of visible) {
        if (isPhd) {
          addProgram(row,ranks);
          continue;
        }
        if (isFaculty) {
          addFaculty(row,ranks.get(defaultSort).get(row));
          continue;
        }
        const tr = body.insertRow();
        for (const [key] of columns) {
          const td = tr.insertCell();
          if (key==='label') { renderLabel(td,row); continue; }
          const value = row[key];
          if (typeof value==='number') td.className = 'demo-numeric';
          td.textContent = value==null || value==='' ? '—'
            : ['year','phd'].includes(key) ? String(value)
            : typeof value==='number' ? format.format(value) : value;
        }
      }
      if (!visible.length) {
        const td = body.insertRow().insertCell();
        td.colSpan = columns.length+Number(hasRankColumn);
        if (isFaculty) {
          const empty = element('div');
          empty.className = 'empty-state';
          empty.append(element('strong','No matching faculty'),'Try changing the search, PhD filters, or journal set.');
          td.append(empty);
        } else td.textContent = 'No records match these filters.';
      }
      coverage.textContent = isFaculty
        ? `${format.format(matches.length)} matching faculty`
        : `${format.format(matches.length)} PhD programs`;
      control('prev').disabled = start===0;
      control('next').disabled = start+limit>=matches.length;
      control('page-status').textContent = matches.length ? `${start+1}–${start+visible.length} of ${matches.length}` : '0 results';
      const years = `Publication years ${Number(cutoff.value)+1}–${end}`;
      const cohort = isPhd ? `PhD graduation years ${first.value}–${last.value} · ` : '';
      const subfield = isEconomics && kind==='primary' ? `${label} · ` : '';
      control('settings').textContent = `${subfield}${cohort}${years} · ${journals.selectedOptions[0].textContent}.`;
    }

    if (researchCard) {
      updateField();
      return;
    }
    if (isTenure) {
      control('method').textContent = 'The chart includes career years 6–11 and requires at least one recorded publication in the selected journals. Missing histories limit coverage, especially for older cohorts. Select a dot to see the underlying publications.';
      cutoff.addEventListener('change',update);
      journals.addEventListener('change',redrawTenureSelection);
      document.getElementById('atlas-year-adjustment').addEventListener('change',redrawTenureSelection);
      configureTenure();
      updateField();
      return;
    }
    const squareRootNote = 'Each faculty author receives full journal credit.';
    control('method').textContent = {
      phd:`Programs sum annual publication rates for tracked graduates in this field. Each graduate’s rate starts in their PhD year or at the start of the selected publication window, whichever is later. Current-employer rates use distinct papers by field faculty at each graduate’s current unit over the full window. ${squareRootNote}`,
      faculty:`${squareRootNote} Coverage reflects the journals and faculty linked in Econ Atlas.`
    }[view];
    if (hasRankColumn) {
      const rankHeading = element('th','');
      rankHeading.setAttribute('aria-label', 'Rank');
      rankHeading.scope = 'col';
      rankHeading.className = 'rank-col frozen-rank';
      table.tHead.rows[0].append(rankHeading);
    }
    for (const [key,label] of columns) {
      const sortable = scoreColumns.has(key);
      const th = element('th',sortable ? null : label);
      th.scope = 'col';
      th.dataset.column = key;
      th.className = key==='label' ? 'school-col frozen-school'
        : isPhd ? 'window-col numeric-col' : sortable || key==='phd' ? 'numeric-col' : '';
      if (sortable) {
        const button = element('button');
        button.type = 'button';
        button.className = 'sort-button';
        const heading = element('span',label);
        if (isPhd) heading.append(element('br'),'pubs/year');
        const indicator = element('span','↓');
        indicator.className = 'sort-indicator';
        indicator.setAttribute('aria-hidden','true');
        button.append(heading,indicator);
        button.addEventListener('click',()=>{
          if (sort===key) return;
          sort = key;
          page = 0;
          draw();
        });
        th.append(button);
      }
      if (isPhd && key==='label') window.SchoolFilter.attach(search,th);
      if (isFaculty && key==='label') window.SchoolFilter.attach(search,th,{
        label:'Search faculty, school or PhD program',placeholder:'Search faculty'
      });
      if (isFaculty && key==='program') window.SchoolFilter.attach(program,th);
      if (isFaculty && key==='school') window.SchoolFilter.attach(currentSchool,th,{label:'Filter by current school',placeholder:'Current school'});
      if (isFaculty && key==='phd') window.SchoolFilter.attach(graduationYear,th,{
        label:'Filter by PhD graduation year',placeholder:'PhD graduation year'
      });
      table.tHead.rows[0].append(th);
    }
    for (const input of [cutoff,journals]) input.addEventListener('change',update);
    program.addEventListener('input',update);
    for (const input of [first,last]) input.addEventListener('change',()=>{
      last.setCustomValidity(first.valueAsNumber>last.valueAsNumber?'Enter a year at or after the start year.':'');
      if (first.value && last.value && first.reportValidity() && last.reportValidity()) update();
    });
    search.addEventListener('input',()=>{page=0;draw();});
    currentSchool?.addEventListener('input',()=>{page=0;draw();});
    graduationYear?.addEventListener('input',()=>{page=0;draw();});
    pageSize.addEventListener('change',()=>{page=0;draw();});
    control('prev').addEventListener('click',()=>{page--;draw();});
    control('next').addEventListener('click',()=>{page++;draw();});
    updateField();
  }

  async function loadFieldData() {
    const manifestResponse=await fetch('/rankings/research/fields/manifest.json',{cache:'no-cache'});
    if (!manifestResponse.ok) throw new Error('Econ Atlas data manifest is unavailable.');
    const manifest=await manifestResponse.json();
    let cache;
    try { cache=await window.caches?.open('field-data-v1'); } catch {}
    async function loadShard(url) {
      if (cache) {
        try {
          const saved=await cache.match(url);
          if (saved) return await saved.json();
        } catch {}
      }
      const response=await fetch(url);
      if (!response.ok) throw new Error('Econ Atlas rankings data is unavailable.');
      const save=cache ? cache.put(url,response.clone()).catch(()=>{}) : Promise.resolve();
      const [data]=await Promise.all([response.json(),save]);
      return data;
    }
    const groups={Finance:'finance',Accounting:'accounting',Economics:'economics',Marketing:'marketing',
      Management:'management','Operations & IS':'operations',Combined:'combined'};
    const group=requestedKind==='primary' ? requestedName.split(':',1)[0] : requestedName;
    const paperShard=requestedKind==='tag' ? 'all' : groups[group] || 'all';
    const [common,papers,tenure]=await Promise.all([
      loadShard(manifest.common),loadShard(manifest[paperShard]),
      isTenure ? loadShard(manifest.tenure) : Promise.resolve({})
    ]);
    return {...common,...tenure,papers};
  }
  loadFieldData().then(mount).catch(error => {
    coverage.textContent = 'Econ Atlas rankings could not be loaded.';
    console.error(error);
  });
})();
