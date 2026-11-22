/* Presentation layer. Core: getOptions()/getRankings(). Optional data section: getDataOverview()/getPublicData(). */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const number = value => new Intl.NumberFormat('en-US').format(value);
  const decimal = value => {
    if (value == null) return '—';
    const rounded = value.toFixed(1);
    return rounded === '-0.0' ? '0.0' : rounded;
  };
  const contributionText = value => value == null ? '—' : value > 0 && value < 0.005 ? '<0.01' : value.toFixed(2);
  const appointmentLabel = g => (g.destinationLabel || g.destination.short_name || g.destination.name) + ({past:' (past)',past_unverified:' (past, unverified)',unverified:' (unverified)'}[g.displayStatus] || (g.displayStatus ? '' : g.currentAffiliationVerified === false ? ' (unverified)' : ''));
  const safeURL = value => { try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
  let middleware, options, result, state = {}, requestNumber = 0;
  const SCORE_WINDOWS = [2015, 2005, 'all'];
  const SOURCE_WINDOWS = [2015];
  const SOURCE_EXPORT_WINDOWS = [2015, 2005, 'all'];
  const DEFAULT_WINDOW = 2015;
  const PAGE_SIZES = [20, 50, 100];
  let tablePage = 0, pageSize = 20;
  let coverageTrigger = null;
  let selfPlacementTrigger = null;
  const SOURCE_IDS = [];
  const publicationData = window.PHD_PUBLICATION_DATA;
  const savedJournals = new URLSearchParams(location.search).getAll('customJournal').filter(name=>publicationData?.journals?.includes(name));
  const customJournals = new Set(savedJournals.length ? savedJournals : (publicationData?.coreJournals || []));
  const schoolSearch = publicationData ? $('#program-school-filter') : null;
  const markSchoolFilter = schoolSearch && (() => {
    const heading = $('.institution-heading');
    heading.textContent = 'PhD Granter, Location';
    return window.SchoolFilter.attach(schoolSearch, heading);
  })();
  const demoColumns = [
    ['tracked', '# tracked'],
    ['graduate-publications', 'Graduates combined'],
    ['current-job', "Graduates' employers"]
  ];
  const demoScoreUnit = 'pubs/year';
  const initialSort = years => ({ key: publicationData ? 'graduate-publications' : `score:${years}`, descending: true });
  const columnCount = () => publicationData ? 2 + demoColumns.length : 3 + SCORE_WINDOWS.length + SOURCE_WINDOWS.length*SOURCE_IDS.length;
  const scoreText = decimal;
  const mainScoreText = value => value == null ? '—' : number(Math.round(value));
  const rankText = value => value == null ? '—' : `#${value}`;
  const subIndexText = (value, status) => status === 'suppressed' ? '*' : rankText(value);
  const sourceValueText = (row, id) => row.isUnit ? '' : subIndexText(row.sourceRanks?.[id], row.sourceStatuses?.[id]);
  const countryFlag = school => school.country_code !== 'US' && /^[A-Z]{2}$/.test(school.country_code || '') ? String.fromCodePoint(...[...school.country_code].map(letter => 0x1F1E6 + letter.charCodeAt(0) - 65)) : '';
  const rankMarkup = label => label.replace(/^#/, '<sup class="rank-prefix">#</sup>');
  const MINIMUM_CELL_MESSAGE = 'Suppressed as <3 tracked graduates';
  const minimumCellSuppressed = row => !row.isUnit && row.allTimeGraduateCount < 3;
  const windowLabel = years => years === 'all' ? 'All years' : `${years}+`;
  const sourceWindowLabel = years => years === 'all' ? 'All' : `’${String(years).slice(-2)}+`;
  const cohortLabel = cohort => cohort.startYear == null ? `All observed years through ${cohort.endYear}` : `${cohort.startYear}–${cohort.endYear}`;
  let sort = initialSort(DEFAULT_WINDOW), query = '';
  let windowResults = new Map();
  const expanded = new Set();
  let lastDialogTrigger = null;
  const overviewCache = new Map();
  const PAGE_SECTIONS = ['results','decade-panel','previous-panel','data','methodology','limitations','conflicts','corrections','remove-your-data'];

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const next = { ...options.defaults };
    next.mode = 'average_score_weighted';
    if (options.universes.some(x => x.id === p.get('universe'))) next.universe = p.get('universe');
    const requestedYears = p.get('years') === 'all' ? 'all' : Number(p.get('years'));
    const years = requestedYears === 10 ? 2015 : requestedYears === 20 ? 2005 : requestedYears;
    if (publicationData) {
      next.years = 'all';
      const start = years === 'all' ? 1900 : SCORE_WINDOWS.includes(years) ? years : DEFAULT_WINDOW;
      next.graduationRange = {from:start, to:options.meta.as_of_year};
    } else if (SCORE_WINDOWS.includes(years)) next.years = years;
    if (!publicationData && options.appointments.some(x => x.id === p.get('appointment'))) next.appointment = p.get('appointment');
    if (publicationData) {
      const params = new URLSearchParams(location.search);
      const integer = key => /^\d+$/.test(params.get(key) ?? '') ? Number(params.get(key)) : NaN;
      query = params.get('school') || '';
      const from = integer('from'), to = integer('to');
      if (1900 <= from && from <= to && to <= options.meta.as_of_year) next.graduationRange = {from,to};
      if (options.universes.some(region => region.id === params.get('region'))) next.universe = params.get('region');
      next.journals = params.get('journals')==='custom' ? 'custom' : [0,1,2].includes(integer('journals')) ? integer('journals') : 1;
      next.window = [5,10,20].includes(integer('window')) ? integer('window') : 10;
      const key = params.get('sort');
      if (key === 'rank' || demoColumns.some(([column]) => column === key && column !== 'tracked')) {
        next.sort = {key, descending:key !== 'rank'};
      }
    }
    return next;
  }
  function clearFilterHash() {
    // Read older filter links once, then keep filter choices in memory.
    const params = new URLSearchParams(location.hash.slice(1));
    if (!['mode', 'universe', 'years', 'appointment'].some(key => params.has(key))) return;
    try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* Some local-file environments disallow history writes. */ }
  }
  const optionLabel = (list, id) => list.find(x => x.id === id)?.label || id;
  function radioButtons(items, key) {
    return items.map(item => `<button type="button" role="radio" aria-checked="${state[key] === item.id}" tabindex="${state[key] === item.id ? '0' : '-1'}" data-key="${key}" data-value="${escape(item.id)}">${escape(item.label)}</button>`).join('');
  }
  function buildControls() {
    if (!publicationData) $('#universe-controls').innerHTML = radioButtons(options.universes, 'universe');
    syncControls();
    if (publicationData) {
      const form = $('#demo-placement-cohort');
      form.elements.from.max = form.elements.to.max = options.meta.as_of_year;
      const table = $('.rankings-table');
      if (table.classList.contains('demo-placement-table')) return;
      table.classList.add('demo-placement-table','demo-atlas-phd-table');
      [...table.querySelectorAll('col.window-col')].slice(demoColumns.length).forEach(column => column.remove());
      table.querySelector('col.graduate-col').remove();
      const header = table.querySelector('.metric-group-row');
      [...header.cells].slice(2).forEach(cell => cell.remove());
      for (const cell of header.cells) cell.rowSpan = 1;
      table.querySelector('.table-heading-row').remove();
      table.querySelector('col.window-col').classList.add('demo-tracked-col');
      header.insertAdjacentHTML('beforeend', demoColumns.map(([key,label]) =>
        `<th class="window-col numeric-col" scope="col">${key === 'tracked' ? label :
          `<button class="sort-button" data-sort="${key}" type="button"><span>${label}<br> ${demoScoreUnit}</span><span class="sort-indicator" aria-hidden="true">↓</span></button>`}</th>`).join(''));
      return;
    }
    SOURCE_IDS.splice(0, SOURCE_IDS.length, ...(options.sourceColumns || []).map(s=>s.id));
    document.querySelectorAll('[data-source-column]').forEach(node => node.remove());
    $('.rankings-table colgroup').insertAdjacentHTML('beforeend', SOURCE_IDS.flatMap(() => SOURCE_WINDOWS.map(() => '<col class="source-col" data-source-column/>')).join(''));
    $('.metric-group-row').insertAdjacentHTML('beforeend', SOURCE_IDS.map((id,sourceIndex) =>
      `<th class="metric-group-heading source-group-heading${sourceIndex===0?' source-group-start':''}" scope="col" data-source-column><button class="metric-sort-button" type="button" data-sort-default="sub:${escape(id)}:${DEFAULT_WINDOW}" aria-label="Sort by ${escape(sourceName(id))} rank for graduates from 2015 onward">${escape(sourceHeading(id))}</button></th>`).join(''));
    $('.table-heading-row').insertAdjacentHTML('beforeend', SOURCE_IDS.flatMap((id,sourceIndex) => SOURCE_WINDOWS.map(years =>
      `<th class="source-col${sourceIndex===0?' source-group-start':''}" scope="col" aria-sort="none" data-source-column><button class="sort-button" data-sort="sub:${escape(id)}:${years}" aria-label="Sort by ${escape(sourceName(id))} rank for graduates from 2015 onward">’15+ <span class="sort-indicator" aria-hidden="true">↑</span></button></th>`)).join(''));
    $('.rankings-table').classList.toggle('has-subscores', SOURCE_IDS.length > 0);
  }
  function syncControls() {
    document.querySelectorAll('button[data-key]').forEach(button => {
      const selected = String(state[button.dataset.key]) === button.dataset.value;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    if (publicationData) return;
    $('#region-selection').textContent = optionLabel(options.universes,state.universe);
    $('#region-selection').hidden = state.universe === 'all';
    $('#region-filter').classList.toggle('filtered',state.universe !== 'all');
    $('#region-filter').setAttribute('aria-label',`Region: ${optionLabel(options.universes,state.universe)}. Filter schools being ranked`);
  }
  function publicationRates() {
    const weight = 'full';
    const selected = $('#demo-publication-journals').value;
    const journalSet = selected==='custom' ? 'custom' : Number(selected);
    const note = $('#demo-journal-note');
    if (note) {
      const names=journalSet==='custom'?[...customJournals]:journalSet===0?publicationData.coreJournals:journalSet===1?publicationData.reviewedJournals:publicationData.journals;
      const base=names.filter(name=>journalSet==='custom' || publicationData.reviewedJournals.includes(name));
      const half=journalSet===2?names.filter(name=>!publicationData.reviewedJournals.includes(name)):[];
      const short=list=>list.map(window.JournalLabels.short).join(', ');
      note.textContent=`Journals: ${short(base)}${half.length?`; half credit: ${short(half)}`:''}.`;
    }
    const windowYears = Number($('#demo-publication-window').value);
    const endYear = publicationData.endYear;
    const startYear = endYear - windowYears + 1;
    function rate(works, from) {
      if (!works || from > endYear) return null;
      let credits = 0;
      for (const [year,group,,journal] of works) {
        if (year < from || year > endYear || (journalSet==='custom' ? !customJournals.has(journal) : group > journalSet)) continue;
        credits += journalSet==='custom' ? 1 : group === 2 ? 0.5 : 1;
      }
      return credits ? credits / (endYear - from + 1) : null;
    }
    function matchingZeroReview(review, from) {
      return (journalSet==='custom' ? [...customJournals].every(name=>publicationData.reviewedJournals.includes(name)) : journalSet <= 1) && review && from >= review.from && endYear <= review.through
        ? review : null;
    }
    function graduateEvidence(graduate) {
      if (!Number.isInteger(graduate.phdYear) || graduate.phdYear > endYear) {
        return {status:null, rate:null, review:null};
      }
      const from = Math.max(startYear, graduate.phdYear);
      const match = rate(publicationData.graduates[graduate.facultyId], from);
      if (match != null) return {status:'matched', rate:match, review:null};
      const review = matchingZeroReview(publicationData.confirmedZeros?.[graduate.facultyId], from);
      return review ? {status:'reviewedZero', rate:0, review} : {status:'noMatch', rate:null, review:null};
    }
    const emptyCounts = () => ({matched:0, reviewedZero:0, noMatch:0, eligible:0});
    const rosterStatuses = new Map();
    const employerEvidence = new Map();
    for (const [school, roster] of Object.entries(publicationData.employerRosters || {})) {
      const members = new Map();
      const counts = emptyCounts();
      for (const [facultyId, years] of Object.entries(roster)) {
        const matched = journalSet==='custom'
          ? (publicationData.facultyPublications[facultyId] || []).some(([year,,,journal])=>year>=startYear && year<=endYear && customJournals.has(journal))
          : years.some((year,group) => group <= journalSet && year >= startYear);
        const review = matchingZeroReview(publicationData.employerConfirmedZeros?.[facultyId], startYear)
          || matchingZeroReview(publicationData.confirmedZeros?.[facultyId], startYear);
        const status = matched ? 'matched' : review ? 'reviewedZero' : 'noMatch';
        members.set(facultyId, status);
        counts[status]++;
        counts.eligible++;
      }
      rosterStatuses.set(school, members);
      employerEvidence.set(school, counts);
    }
    const destinationWeights = new Map(Object.entries(publicationData.employers)
      .map(([school, works]) => {
        const counts = employerEvidence.get(school);
        const fullyReviewedZero = counts?.reviewedZero > 0 && counts.reviewedZero === counts.eligible;
        const score = rate(works, startYear) ?? (fullyReviewedZero ? 0 : null);
        if (counts) counts.rate = score;
        return [school, score];
      }));
    function currentJobEvidence(graduates) {
      const schools = new Set(graduates.filter(graduate => graduate.displayStatus === 'current' && graduate.eligibleForCredit)
        .map(graduate => graduate.destination.school_id));
      const members = new Set();
      const counts = emptyCounts();
      for (const school of schools) {
        for (const [facultyId, status] of rosterStatuses.get(school) || []) {
          if (members.has(facultyId)) continue;
          members.add(facultyId);
          counts[status]++;
          counts.eligible++;
        }
      }
      return counts;
    }
    return {
      destinationWeights, startYear, endYear, windowYears, weight, journalSet,
      graduateEvidence, employerEvidence, currentJobEvidence, emptyCounts
    };
  }
  async function demoRankings(config) {
    const publications = publicationRates();
    const current = await middleware.getRankings(config,{destinationWeights:publications.destinationWeights});
    function merge(currentRow) {
      const graduateRate = {rate:0, ...publications.emptyCounts()};
      for (const graduate of currentRow.graduates) {
        const {status, rate} = publications.graduateEvidence(graduate);
        if (!status) continue;
        graduateRate.eligible++;
        graduateRate[status]++;
        if (rate != null) graduateRate.rate += rate * graduate.creditWeight;
      }
      if (!graduateRate.matched && !graduateRate.reviewedZero) graduateRate.rate = null;
      return {
        school:currentRow.school, rank:null, currentJob:currentRow,
        graduateRate, currentJobEvidence:publications.currentJobEvidence(currentRow.graduates),
        units:(currentRow.units || []).map(unit => ({
          ...merge(unit), parentSchoolId:currentRow.school.school_id, isUnit:true
        }))
      };
    }
    const rows = current.rows.map(merge);
    const ranked = rows.filter(row => row.graduateRate.rate != null)
      .sort((a,b) => b.graduateRate.rate - a.graduateRate.rate);
    for (const [i,row] of ranked.entries()) {
      const previous = ranked[i-1];
      row.rank = previous && Math.abs(previous.graduateRate.rate - row.graduateRate.rate) <= 1e-12
        ? previous.rank : i+1;
    }
    return { ...current, rows, listedProgramCount:rows.length, publications };
  }
  async function refresh() {
    const token = ++requestNumber;
    syncControls();
    clearFilterHash();
    $('#results').setAttribute('aria-busy', 'true');
    $('#status').textContent = 'Updating rankings.';
    $('#export-button').disabled = true;
    try {
      const config = { ...state };
      if (!overviewCache.has(config.mode)) {
        overviewCache.set(config.mode, typeof middleware.getDataOverview === 'function'
          ? Promise.resolve().then(() => middleware.getDataOverview({ mode: config.mode })).catch(error => ({ error: error.message || 'Unable to load the data overview.' }))
          : Promise.resolve(null));
      }
      if (publicationData) {
        const [next,overview] = await Promise.all([demoRankings(config), overviewCache.get(config.mode)]);
        if (token !== requestNumber) return;
        result = next;
        window.SchoolFilter.suggest(schoolSearch, result.rows.map(programSearchFields));
        renderTable();
        renderDataOverview(overview);
        $('#results').setAttribute('aria-busy', 'false');
        return;
      }
      const [responses, overview] = await Promise.all([
        Promise.all(SCORE_WINDOWS.map(years => middleware.getRankings({ ...config, years }))),
        overviewCache.get(config.mode)
      ]);
      if (token !== requestNumber) return; // Ignore an outdated async response.
      windowResults = new Map(SCORE_WINDOWS.map((years, i) => [String(years), responses[i]]));
      const next = windowResults.get(String(config.years));
      const all = windowResults.get('all');
      const byWindow = new Map(SCORE_WINDOWS.map(years => [String(years), new Map(windowResults.get(String(years)).rows.map(row => [row.school.school_id, row]))]));
      const emptyRow = school => ({ school, rank: null, globalRank: null, score: 0, displayScore: null, sourceRanks: {}, sourceContributorCounts: Object.fromEntries(SOURCE_IDS.map(id => [id, 0])), sourceStatuses: Object.fromEntries(SOURCE_IDS.map(id => [id, 'suppressed'])), sourceMissingCounts: {}, hasScore: false, graduateCount: 0, scoredCount: 0, averageWeight: null, destinationCount: 0, missingScoreCount: 0, graduates: [], units: [] });
      function mergeWindows(allRow, metrics) {
        const windows = Object.fromEntries(SCORE_WINDOWS.map(years => [String(years), metrics.get(String(years)) || emptyRow(allRow.school)]));
        const units = (allRow.units || []).map(unit => {
          const unitMetrics = new Map(SCORE_WINDOWS.map(years => [String(years), (windows[String(years)].units || []).find(u => u.school.school_id === unit.school.school_id)]));
          return { ...mergeWindows(unit,unitMetrics), parentSchoolId: allRow.school.school_id, isUnit: true };
        });
        const active = windows[String(config.years)];
        const sourceWindow = active;
        const sourceStatuses = {};
        for (const id of SOURCE_IDS) {
          const suppressed = allRow.graduateCount < 3;
          sourceStatuses[id] = suppressed ? 'suppressed' : sourceWindow.sourceStatuses?.[id] || 'unavailable';
        }
        return { ...active, sourceStatuses,
          sourceContributorCounts: sourceWindow.sourceContributorCounts, sourceMissingCounts: sourceWindow.sourceMissingCounts,
          sourceRanks: sourceWindow.sourceRanks, sourceGraduateCount: sourceWindow.graduateCount,
          windows, units, allTimeGraduateCount: allRow.graduateCount, isUnit: false };
      }
      // Keep older origins and their units visible even when the active cohort is empty.
      const rows = all.rows.map(row => mergeWindows(row, new Map(SCORE_WINDOWS.map(years => [String(years),byWindow.get(String(years)).get(row.school.school_id)]))));
      result = { ...next, rows, listedProgramCount: all.rows.length };
      renderSummary();
      renderTable();
      renderDataOverview(overview);
      $('#results').setAttribute('aria-busy', 'false');
      $('#status').textContent = `${visibleRows().length} programs · ${next.totals.graduateCount} graduates · ${cohortLabel(next.cohort)} · ${optionLabel(options.appointments,state.appointment)}.`;
    } catch (error) {
      if (token !== requestNumber) return;
      showError(error);
    }
  }
  function renderDataOverview(overview) {
    const stanfordAnnual = overview?.metaRanking?.find(row => row.school.school_id === 'stanford_university')?.metaScore;
    const stanfordExample = $('#stanford-example-annual');
    if (stanfordExample) stanfordExample.textContent = Number.isFinite(stanfordAnnual) ? stanfordAnnual.toFixed(1) : '—';
    const download = $('#data-download');
    if (!download) return;
    download.disabled = typeof middleware.getPublicData !== 'function' || middleware.isFullDataReady?.() === false;
    if (!overview || overview.error) {
      $('#data-download-note').textContent = overview?.error || 'Data inventory unavailable.';
      return;
    }
    $('#finance-faculty-count').textContent = number(overview.inventory.financeFacultyCount);
    $('#employing-university-count').textContent = number(overview.inventory.employingUniversityCount);
  }
  async function downloadPublicData() {
    if (typeof middleware?.getPublicData !== 'function') return;
    const button = $('#data-download'); button.disabled = true;
    try {
      const payload = await middleware.getPublicData();
      if (result?.detailsPending) { overviewCache.clear(); await refresh(); }
      const blob = new Blob([JSON.stringify(payload)+'\n'], {type:'application/json;charset=utf-8'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url;
      link.download = `finance-placement-public-data-${options.meta.as_of}${options.meta.is_synthetic ? '-SYNTHETIC' : ''}.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url),1000);
      $('#status').textContent = 'Public data downloaded. Original provider rankings and private provider weights are not included.';
    } catch (error) {
      $('#data-download-note').textContent = `Unable to download public data: ${error.message || 'Unknown error'}`;
      $('#status').textContent = 'Public data download failed.';
    } finally { button.disabled = false; }
  }
  function renderSummary() {
    if (publicationData) {
      $('#result-summary').textContent = cohortLabel(result.cohort);
      const {startYear,endYear,windowYears} = result.publications;
      const journal = $('#demo-publication-journals').selectedOptions[0].textContent;
      const legacyRegion = result.config.universe === 'all' ? '' : optionLabel(options.universes,result.config.universe);
      const filter = query.trim() || legacyRegion;
      $('#demo-publication-period').textContent =
        `PhD graduation years ${cohortLabel(result.cohort)} · Publication years ${startYear}–${endYear} (${windowYears} years) · ${journal}${filter ? ` · Filter ${filter}` : ''}.`;
      const rows = visibleRows();
      const usablePublications = rows.filter(row => row.graduateRate.rate != null).length;
      const usableEmployers = rows.filter(row => row.currentJob.hasScore).length;
      const programs = rows.length === 1 ? "program" : "programs";
      const coverage = `${number(usablePublications)} of ${number(rows.length)} ${programs} ${usablePublications === 1 ? "has" : "have"} a graduate publication score. ${number(usableEmployers)} ${usableEmployers === 1 ? "has" : "have"} a current-employer score.`;
      $('#status').textContent = `${number(rows.length)} ${programs} · ${cohortLabel(result.cohort)}.`;
      const beyondWindow = result.cohort.startYear > endYear;
      $('#demo-score-coverage').textContent = beyondWindow
        ? `Graduate publication data end in ${endYear}. Current-employer scores use the selected publication window. ${coverage}`
        : coverage;
      return;
    }
    $('#program-count').textContent = number(visibleRows().length);
    $('#result-summary').textContent = `${optionLabel(options.appointments,state.appointment)} · ${windowLabel(state.years)}`;
    const incomplete=SCORE_WINDOWS.filter(years=>windowResults.get(String(years)).totals.missingScoreCount>0);
    $('#data-warning').hidden = !incomplete.length;
    $('#data-warning').textContent = incomplete.length ? `Some placements lack scoring inputs in ${incomplete.map(windowLabel).join(', ')}.` : '';
  }
  function programSearchFields({school}) {
    return {
      name:school.name, country:school.country, region:school.region, code:school.country_code,
      aliases:[school.short_name]
    };
  }
  function visibleRows() {
    if (!result) return [];
    const needle = query.trim().toLocaleLowerCase();
    const rows = result.rows.filter(row => !needle || (publicationData
      ? window.SchoolFilter.matches(programSearchFields(row),query) : [row.school.name,row.school.short_name,row.school.city,row.school.business_school,row.school.country,row.school.region,...(row.units || []).map(unit => unit.school.name)].some(x => String(x || '').toLocaleLowerCase().includes(needle))));
    const numericValue = row => {
      if (sort.key === 'graduates') return row.allTimeGraduateCount;
      if (publicationData && sort.key !== 'rank') return demoScore(row,sort.key);
      if (sort.key === 'rank') return row.rank;
      if (sort.key.startsWith('score:')) { const metric = row.windows[sort.key.slice(6)]; return metric.hasScore ? metric.score : null; }
      if (sort.key.startsWith('sub:')) {
        const [id,years]=sort.key.slice(4).split(':');
        return (years ? row.windows?.[years]?.sourceRanks?.[id] : row.sourceRanks?.[id]) ?? null;
      }
      return row.hasScore ? row.score : null;
    };
    rows.sort((a,b) => {
      let difference;
      {
        const av = numericValue(a), bv = numericValue(b);
        if (av == null || bv == null) return av === bv ? a.school.name.localeCompare(b.school.name) : av == null ? 1 : -1;
        difference = av - bv;
      }
      return (sort.descending ? -difference : difference) || a.school.name.localeCompare(b.school.name);
    });
    return rows;
  }
  function pageRows(rows) {
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    tablePage = Math.max(0, Math.min(tablePage, pageCount - 1));
    return rows.slice(tablePage * pageSize, (tablePage + 1) * pageSize);
  }
  function renderPagination(total) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const start = total ? tablePage * pageSize + 1 : 0;
    const end = Math.min(total, (tablePage + 1) * pageSize);
    $('#table-page-status').textContent = `${number(start)}–${number(end)} of ${number(total)} universities · Page ${tablePage + 1} of ${pages}`;
    for (const [direction,disabled] of [['prev',tablePage === 0],['next',tablePage >= pages - 1]]) {
      $(`#table-page-${direction}`).disabled = disabled;
      const top = $(`#table-page-${direction}-top`);
      if (top) top.disabled = disabled;
    }
    $('#table-page-size').value = String(pageSize);
  }
  const defaultSubunitSchools = new Set(window.PHD_SITE_CONFIG?.defaultExpandedSubunitSchools || []);
  const hiddenRankingSubunits = new Set(window.PHD_SITE_CONFIG?.hiddenRankingSubunits || []);
  const alwaysShownRankingSubunits = new Set(window.PHD_SITE_CONFIG?.alwaysShownRankingSubunits || []);
  function displayedUnits(row) {
    if (!defaultSubunitSchools.has(row.school.school_id)) return [];
    return (row.units || []).filter(unit => (alwaysShownRankingSubunits.has(unit.school.school_id) || (publicationData ? demoColumns.some(([key]) => key !== 'tracked' && demoScore(unit,key) > 0.25) : unit.windows[String(DEFAULT_WINDOW)].score > 0.25)) && unit.school.show_in_rankings !== false && !hiddenRankingSubunits.has(unit.school.school_id))
      .sort((a, b) => (a.school.display_order || 0) - (b.school.display_order || 0) || a.school.name.localeCompare(b.school.name));
  }
  const flattenedRows = () => visibleRows().flatMap(row => [row,...displayedUnits(row)]);
  const findRow = sid => result?.rows.flatMap(row => [row,...(row.units || [])]).find(row => row.school.school_id === sid);
  function unitLabel(school, university) {
    const label = school.source_unit_name || school.name;
    const fullName = university?.name || '';
    const prefixes = [fullName, fullName.replace(/^University of\s+/i, '').replace(/\s+University$/i, '')].filter(Boolean);
    for (const prefix of prefixes) {
      const suffix = label.slice(prefix.length);
      if (label.toLowerCase().startsWith(prefix.toLowerCase()) && /^[\s·:–—-]/.test(suffix)) {
        return suffix.replace(/^[\s·:–—-]+/, '') || label;
      }
    }
    return label;
  }
  const programLabel = row => row.isUnit ? unitLabel(row.school, findRow(row.parentSchoolId)?.school) : (row.school.short_name || row.school.name);
  const locationLabel = school => {
    const city = school.city && school.city !== 'Unknown' ? school.city : '-';
    const country = school.country && school.country !== 'Unknown' ? school.country : '-';
    if (school.country_code === 'US') return `${city}${school.state_code ? ` ${school.state_code}` : ''}`;
    const label = city === country ? country : `${city}, ${country}`;
    return label;
  };
  const regionLabel = school => school.country_code === 'US' ? 'US' : school.country_code === 'CA' ? 'Canada' : school.region || school.country || '—';
  const sourceName = id => options.sourceColumns?.find(s => s.id === id)?.name || id.toUpperCase();
  const sourceHeading = id => ({'U.S. News': 'USN', 'UT Dallas': 'UTD'})[sourceName(id)] || sourceName(id);
  function updateFrozenColumns() {
    const table = $('.rankings-table'), scroller = $('.table-scroll');
    const first = table?.querySelector('thead .rank-col');
    if (!first || !scroller || !scroller.clientWidth) return;
    const viewport = scroller.clientWidth, compact = viewport <= 640;
    const rankWidth = compact ? 36 : 31;
    const frozenWidth = viewport * (compact ? 0.5 : 1/3);
    const schoolWidth = Math.max(0, frozenWidth - rankWidth);
    const sourceCount = SOURCE_IDS.length * SOURCE_WINDOWS.length;
    const otherWidth = (viewport - frozenWidth) / (SCORE_WINDOWS.length * 1.5 + sourceCount + 1);
    const trackedWidth = compact ? 54 : 70;
    const demoScoreCount = publicationData ? demoColumns.length - 1 : 0;
    const scoreWidth = publicationData ? Math.max(86, (viewport - frozenWidth - trackedWidth) / demoScoreCount)
      : compact ? (viewport - frozenWidth) / SCORE_WINDOWS.length : otherWidth * 1.5;
    const graduateWidth = compact ? 42 : otherWidth, sourceWidth = compact ? 32 : otherWidth;
    const tableWidth = frozenWidth + (publicationData ? demoScoreCount * scoreWidth + trackedWidth : SCORE_WINDOWS.length * scoreWidth + graduateWidth + sourceCount * sourceWidth);
    table.classList.toggle('compact-table', compact);
    for (const [name, width] of Object.entries({table:tableWidth, rank:rankWidth, school:schoolWidth, window:scoreWidth, graduate:graduateWidth, source:sourceWidth})) {
      table.style.setProperty(`--ranking-${name}-width`, `${width}px`);
    }
    table.style.setProperty('--table-viewport-width', `${viewport}px`);
    if (publicationData) table.style.setProperty('--ranking-tracked-width', `${trackedWidth}px`);
    table.style.setProperty('--frozen-rank-width', `${first.getBoundingClientRect().width}px`);
    const school = table.querySelector('thead .school-col');
    scroller.style.scrollPaddingLeft = `${first.getBoundingClientRect().width + school.getBoundingClientRect().width + 8}px`;
  }
  function rankingLink(base) {
    const url = new URL(base, location.href);
    const {from,to} = result.config.graduationRange;
    const {journalSet,windowYears} = result.publications;
    for (const [key,value] of Object.entries({
      from,to,journals:journalSet,window:windowYears,region:result.config.universe,
      sort:sort.key,order:sort.descending ? 'desc' : 'asc'
    })) url.searchParams.set(key,value);
    url.searchParams.delete('customJournal');
    if (journalSet==='custom') for (const journal of customJournals) url.searchParams.append('customJournal',journal);
    if (query.trim()) url.searchParams.set('school',query.trim());
    else url.searchParams.delete('school');
    url.hash = 'results';
    return url;
  }
  function updateRankingLinks() {
    const current = rankingLink(location.href);
    history.replaceState(history.state, '', current.pathname + current.search + location.hash);
    const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
    const shared = rankingLink(canonical);
    for (const link of document.querySelectorAll('#results a.caption-icon[aria-label^="Share"]')) {
      const target = new URL(link.href);
      target.searchParams.set('url',shared.href);
      if (target.searchParams.has('text')) target.searchParams.set('text',$('#results-title').textContent);
      link.href = target.href;
    }
  }
  if (publicationData) $('#copy-ranking-link')?.addEventListener('click', async event => {
    if (!result) return;
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(rankingLink(location.href).href);
      button.textContent = 'Link copied';
    } catch {
      button.textContent = 'Copy from address bar';
    }
    setTimeout(() => { button.textContent = 'Copy link'; }, 2000);
  });
  function renderTable() {
    for (const id of ['#coverage-popover', '#self-placement-popover']) {
      const popover = $(id);
      if (popover?.matches?.(':popover-open')) popover.hidePopover();
    }
    const matchingRows = visibleRows();
    const rows = pageRows(matchingRows);
    $('#rankings-body').innerHTML = rows.length ? rows.map(row => {
      const sid = row.school.school_id;
      return renderProgram(row, sid) + displayedUnits(row).map(unit => renderProgram(unit, sid)).join('') +
        (expanded.has(sid) ? `<tr class="detail-row" id="detail-${escape(sid)}" data-detail-for="${escape(sid)}"><td colspan="${columnCount()}">${renderGraduates(row)}</td></tr>` : '');
    }).join('') : `<tr><td colspan="${columnCount()}"><div class="empty-state"><strong>No matching programs</strong>${publicationData ? 'Try a different graduation range or region.' : 'Try another origin universe or search term.'}</div></td></tr>`;
    if ($('#program-count')) $('#program-count').textContent = number(matchingRows.length);
    $('#export-button').disabled = !matchingRows.length;
    renderPagination(matchingRows.length);
    for (const button of document.querySelectorAll('[data-sort]')) {
      const active = button.dataset.sort === sort.key;
      button.closest('th').classList.toggle('active-score-column', active);
      button.closest('th').setAttribute('aria-sort', active ? (sort.descending ? 'descending' : 'ascending') : 'none');
      button.querySelector('.sort-indicator').textContent = active ? (sort.descending ? '↓' : '↑') : (button.dataset.sort === 'rank' || button.dataset.sort.startsWith('sub:') ? '↑' : '↓');
    }
    for (const years of SCORE_WINDOWS) {
      const header = $(`[data-score-window="${years}"]`);
      header?.classList.toggle('active-score-column', sort.key === `score:${years}`);
    }
    if (publicationData) {
      renderSummary();
      updateRankingLinks();
    }
    requestAnimationFrame(updateFrozenColumns);
  }
  function scoreCell(metric, years) {
    return `<td class="score-cell${sort.key === `score:${years}` ? ' active-score-column' : ''}" data-metric="${years}"><span class="score-number">${mainScoreText(metric.displayScore)}</span></td>`;
  }
  function displayedRank(row) {
    if (row.isUnit) return null;
    if (sort.key.startsWith('score:')) return row.windows?.[sort.key.slice(6)]?.rank ?? row.rank;
    if (sort.key.startsWith('sub:')) {
      const [id,years]=sort.key.slice(4).split(':');
      return (years ? row.windows?.[years]?.sourceRanks?.[id] : row.sourceRanks?.[id]) ?? null;
    }
    if (sort.key === 'graduates') return 1 + result.rows.filter(other => other.allTimeGraduateCount > row.allTimeGraduateCount).length;
    if (publicationData && sort.key === 'current-job') return row.currentJob?.rank ?? null;
    if (sort.key === 'tracked') {
      const score = demoScore(row,sort.key);
      return score == null ? null : 1 + result.rows.filter(other => demoScore(other,sort.key) > score + 1e-12).length;
    }
    return row.rank;
  }
  function displayedRankText(row) {
    if (sort.key.startsWith('sub:')) {
      const [id, years] = sort.key.slice(4).split(':');
      const metric = years ? row.windows?.[years] : row;
      const status = metric?.sourceStatuses?.[id];
      return status === 'suppressed' ? '—' : subIndexText(displayedRank(row), status);
    }
    return rankText(displayedRank(row));
  }
  function renderProgram(row, groupId) {
    const sid = row.school.school_id, open = expanded.has(groupId), hasUnits = displayedUnits(row).length > 0;
    const rank = displayedRank(row);
    const sourceCells = minimumCellSuppressed(row) && SOURCE_IDS.length
      ? `<td colspan="${SOURCE_WINDOWS.length*SOURCE_IDS.length}" class="minimum-cell-suppression source-group-start">${MINIMUM_CELL_MESSAGE}</td>`
      : SOURCE_IDS.flatMap((id,sourceIndex) => SOURCE_WINDOWS.map((years,index) => {
      const start=(sourceIndex===0&&index===0?' source-group-start':'') + (sort.key === `sub:${id}:${years}` ? ' active-score-column' : '');
      if (row.isUnit) return `<td class="source-cell${start}" data-source="${id}" data-source-years="${years}"></td>`;
      const metric=row.windows[String(years)];
      const status = metric.sourceStatuses?.[id] || 'unavailable';
      const suppressed = status === 'suppressed';
      const label = suppressed ? MINIMUM_CELL_MESSAGE : status === 'unavailable' ? 'Provider score unavailable.' : metric.sourceMissingCounts?.[id] ? `Partial total: ${metric.sourceContributorCounts[id]} of ${metric.graduateCount} placements covered.` : 'All placements covered.';
      return `<td class="source-cell${start}${suppressed ? ' suppressed-score' : ''}" data-source="${id}" data-source-years="${years}" data-score-status="${status}"><span class="score-number"${status !== 'published' ? ` aria-label="${escape(label)}"` : ''}>${rankMarkup(sourceValueText(metric, id))}</span></td>`;
    })).join('');
    return `<tr class="program-row ${row.isUnit ? 'unit-row' : 'university-row'}${hasUnits ? ' has-units' : ''}${open ? ' open' : ''}${!row.isUnit && rank && rank <= 3 ? ' top-ranked' : ''}" data-program="${escape(sid)}" data-group="${escape(groupId)}"${row.isUnit ? ` data-parent="${escape(row.parentSchoolId)}"` : ''}>
      <td class="rank-col frozen-rank${sort.key === 'rank' ? ' active-score-column' : ''}"><span class="rank-number">${row.isUnit ? '<span class="sr-only">Subunit, included in university total</span>' : rankMarkup(displayedRankText(row))}</span></td>
      <td class="school-cell frozen-school"><button class="school-button" data-expand="${escape(groupId)}" data-member="${escape(sid)}" aria-expanded="${open}"${open ? ` aria-controls="detail-${escape(groupId)}"` : ''} title="${escape(row.school.name)}: ${open ? 'collapse' : 'expand'} university placements">${row.isUnit ? '' : `<span class="group-caret" aria-hidden="true">${open ? '−' : '+'}</span>`}<span class="school-name">${escape(programLabel(row))}</span>${!row.isUnit && countryFlag(row.school) ? `<span class="research-country-flag" role="img" aria-label="${escape(row.school.country || 'Country')}">${countryFlag(row.school)}</span>` : ''}</button>${row.isUnit ? '' : `<span class="school-location"> <em>${escape(locationLabel(row.school))}</em></span>`}</td>

      ${publicationData ? demoColumns.map(([key]) => demoScoreCell(row,key)).join('') : `
      ${SCORE_WINDOWS.map(years => scoreCell(row.windows[String(years)], years)).join('')}
      <td class="graduate-number${sort.key === 'graduates' ? ' active-score-column' : ''}">${number(row.allTimeGraduateCount)}</td>
      ${sourceCells}`}
    </tr>`;
  }
  function demoScore(row,key) {
    if (key === 'tracked') return row.currentJob?.graduateCount ?? 0;
    if (key === 'graduate-publications') return row.graduateRate.rate;
    return row.currentJob?.displayScore;
  }
  const publicationEvidenceCounts = [
    ['matched', 'with qualifying publications'],
    ['reviewedZero', 'reviewed zeros'],
    ['noMatch', 'with no qualifying match']
  ];
  function demoScoreCell(row,key) {
    const score = demoScore(row,key);
    const job = row.currentJob;
    const detail = key === 'tracked' ? 'Graduates tracked in the selected graduation-year range.'
      : key === 'graduate-publications'
      ? 'Graduate publication evidence for the selected journals and years.'
      : `${number(job?.scoredCount ?? 0)} of ${number(job?.graduateCount ?? 0)} tracked graduates have a scored current employer.`;
    return `<td class="score-cell${sort.key === key ? ' active-score-column' : ''}" title="${escape(detail)}"><span class="score-number">${key === 'tracked' ? number(score) : contributionText(score)}</span></td>`;
  }
  function renderDemoGraduates(row) {
    const sid = escape(row.school.school_id), school = escape(row.school.name);
    const graduates = row.currentJob?.graduates || [];
    return `<section class="detail-panel" aria-label="Graduates of ${school}">
      <div class="detail-top"><div><h3>${school} · graduates</h3><p>${number(graduates.length)} graduates · ${escape(cohortLabel(result.cohort))}</p></div><button class="detail-close" data-expand="${sid}" aria-label="Collapse ${school} graduates">Collapse −</button></div>
      <div class="detail-table-scroll"><table class="graduates-table demo-graduates-table"><thead><tr>
        <th scope="col">Graduate</th><th scope="col">PhD</th><th scope="col">Publications/year</th>
        <th scope="col">Current affiliation</th><th scope="col">Employer publications/year</th>
      </tr></thead><tbody>${graduates.map(graduate => {
        const active = graduate.displayStatus === 'current' ? graduate : null;
        const phd = [graduate.phdYear ?? 'Undated', graduate.originUnit && unitLabel(graduate.originUnit,row.school)].filter(Boolean).join(', ');
        const evidence = result.publications.graduateEvidence(graduate);
        const evidenceLabel = {matched:'Qualifying publication found',reviewedZero:'Reviewed zero',noMatch:'No qualifying match'}[evidence.status];
        const employer = active?.eligibleForCredit && result.publications.employerEvidence.get(active.destination.school_id);
        const employerDetail = !employer && active?.eligibleForCredit
          ? '<small class="demo-score-coverage">No verified finance roster</small>' : '';
        const name = escape(graduate.name);
        return `<tr><td><button type="button" class="evidence-button demo-graduate-source" data-evidence="${escape(graduate.facultyId)}" data-origin="${sid}" aria-label="Sources for ${name}">+</button> <span class="graduate-name">${name}</span></td>
          <td>${escape(phd)}</td><td>${contributionText(evidence.rate)}${evidenceLabel ? `<small class="demo-score-coverage">${evidenceLabel}</small>` : ''}</td>
          <td>${active ? escape(appointmentLabel(active)) : '—'}</td><td>${contributionText(active?.scored ? active.destinationInput : null)}${employerDetail}</td></tr>`;
      }).join('') || '<tr><td colspan="5">No graduates with placement records for this cohort.</td></tr>'}</tbody></table></div>
    </section>`;
  }
  function renderGraduates(row) {
    if (typeof middleware !== 'undefined' && middleware.isFullDataReady?.() === false) {
      const error = middleware.getDetailLoadError?.();
      return `<section class="detail-panel"><p role="status">${error ? 'Faculty details could not be loaded.' : 'Loading graduate details…'}</p>${error ? '<button class="text-button" data-retry-details>Retry details</button>' : ''}</section>`;
    }
    if (publicationData) return renderDemoGraduates(row);
    const sid = row.school.school_id;
    const placements = row.windows.all;
    const grads = placements.graduates;
    const appointment = optionLabel(options.appointments,state.appointment);
    const destinationScore = g => {
      if (['past','past_unverified'].includes(g.displayStatus)) return '-';
      if (g.eligibleForCredit === false || g.outsideDestinationSample || g.destinationInput === 0) return '<button class="coverage-trigger" type="button" popovertarget="coverage-popover" data-coverage aria-label="Why this destination is not covered">not covered<sup>*</sup></button>';
      const original = contributionText(g.destinationInput);
      if (!g.isSelfPlacement || !(g.selfPlacementFactor < 1) || !(g.destinationInput > 0)) return original;
      const adjusted = contributionText(g.destinationInput * g.selfPlacementFactor);
      return `<button class="self-cap-trigger" type="button" popovertarget="self-placement-popover" data-self-cap aria-label="Self-placement cap: original destination score ${original}; after cap ${adjusted}"><s>${original}</s> <span>${adjusted}</span></button>`;
    };
    return `<section class="detail-panel" aria-label="University placements from ${escape(row.school.name)}">
      <div class="detail-top"><div><h3>${escape(row.school.name)} · placements</h3><p>${number(placements.graduateCount)} graduates · ${number(placements.destinationCount)} destinations · ${escape(appointment)}${row.units?.length ? ' · all doctoral units, counted once' : ''}</p></div><button class="detail-close" data-expand="${escape(sid)}" aria-label="Collapse ${escape(row.school.name)} placements">Collapse −</button></div>
      <div class="detail-table-scroll"><table class="graduates-table"><caption class="sr-only">University placements, labeled by doctoral unit. Destination scores show self-placement cap adjustments when applicable.</caption><thead><tr><th scope="col">Graduate</th><th scope="col">Source</th><th scope="col">PhD</th><th scope="col">Doctoral unit</th><th scope="col">Selected appointment</th><th scope="col">Top-3s/year at destination</th></tr></thead><tbody>
      ${grads.length ? grads.map(g => `<tr${g.eligibleForCredit === false || g.outsideDestinationSample ? ' class="unscored-placement"' : ''}><td><span class="graduate-name">${escape(g.name)}</span></td><td class="evidence-cell"><button class="evidence-button" data-evidence="${escape(g.facultyId)}" data-origin="${escape(sid)}">Evidence ↗</button></td><td>${g.phdYear ?? 'Undated'}</td><td class="doctoral-unit">${escape(g.originUnit ? unitLabel(g.originUnit, row.school) : '-')}${g.creditWeight < 1 ? `<span class="job-title joint-credit">Joint PhD, ${Math.round(100 * g.creditWeight)}% credit</span>` : ''}</td><td><span>${escape(appointmentLabel(g))}</span>${g.isSelfPlacement ? `<span class="job-title self-placement" title="Same university as the doctoral institution">(same)</span>` : ''}${g.incompleteBest ? '<span class="job-title">Best appointment cannot be fully scored.</span>' : ''}</td><td class="contribution">${destinationScore(g)}</td></tr>`).join('') : '<tr><td colspan="6">No observed qualifying placements are supplied for this institution.</td></tr>'}
      </tbody></table></div>
      ${grads.some(g => !['past','past_unverified'].includes(g.displayStatus) && (g.eligibleForCredit === false || g.outsideDestinationSample || g.destinationInput === 0)) ? '<p class="detail-bottom"><sup>*</sup> Excellent small finance departments that do not meet our total publication cutoffs, economics departments, and top central banks are not covered. <a href="#methodology">Refer to the methodology</a>.</p>' : ''}

      <p class="detail-bottom">All observed years, including undated records. Past-only listings show “-”. Unverified, non-finance, and unranked current listings show “not covered”. “Past, unverified” means the placement-list job is historical and current status is unresolved. Destination scores are shown before joint-degree adjustments. When the self-placement cap applies, the original score is crossed out and the capped score appears beside it. Credited contributions appear under Evidence.${result.meta.is_synthetic ? ' Synthetic records.' : ''}</p>
    </section>`;
  }
  function openDialog(kicker, html, trigger) {
    lastDialogTrigger = trigger || document.activeElement;
    $('#dialog-kicker').textContent = kicker;
    $('#dialog-content').innerHTML = html;
    $('#detail-dialog').showModal();
    $('#dialog-close').focus();
  }
  async function showDemoEvidence(row,id,sid,trigger,sourceBlock) {
    const graduate = row?.currentJob?.graduates.find(item => item.facultyId === id);
    if (!graduate) return;
    const {publications, config} = result;
    openDialog('GRADUATE / EVIDENCE', `<h2 id="dialog-title">${escape(graduate.name)}</h2><p role="status">Loading sources…</p>`, trigger);
    const dialog = $('#detail-dialog');
    const content = $('#dialog-content');
    const loading = content.lastElementChild;
    const [placement, articles] = await Promise.allSettled([
      middleware.getGraduateEvidence(config, publications.destinationWeights, sid, id),
      middleware.getPublicationEvidence()
    ]);
    if (!dialog.open || content.lastElementChild !== loading) return;
    const detailed = placement.status === 'fulfilled' ? placement.value : null;
    const current = graduate.displayStatus === 'current';
    const employer = current && graduate.eligibleForCredit && publications.employerEvidence.get(graduate.destination.school_id);
    const heading = current ? `Current affiliation · ${escape(appointmentLabel(graduate))}` : 'Current affiliation';
    const cv = safeURL(detailed?.cvUrl);
    const from = Math.max(publications.startYear, graduate.phdYear);
    const works = articles.status === 'fulfilled' ? articles.value[id] : null;
    const {status,rate,review:zero} = publications.graduateEvidence(graduate);
    const inWindow = ([year,group,,journal]) => year >= from && year <= publications.endYear && (publications.journalSet==='custom' ? customJournals.has(journal) : group <= publications.journalSet);
    const citationLink = citation => {
      const url = safeURL(citation?.[1]);
      if (!url || !Number.isInteger(citation[0]) || citation[0] < 0) return '';
      const provider = citation[2] || 'OpenAlex';
      return ` · <a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${number(citation[0])} ${escape(provider)} ${citation[0] === 1 ? 'citation' : 'citations'} ↗</a>`;
    };
    let paperList;
    if (zero) {
      const sources = zero.sources.map(safeURL).filter(Boolean).map((url, i) =>
        `<li><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Review source ${i+1} ↗</a></li>`);
      paperList = `<p>Confirmed zero Top-3 finance and Top-5 economics publications, ${zero.from}–${zero.through}.</p>${zero.note ? `<p>${escape(zero.note)}</p>` : ''}<ul>${sources.join('')}</ul>`;
    }
    else if (status === 'noMatch') paperList = '<p>No qualifying publication match for the selected journals and years.</p>';
    else if (articles.status === 'rejected') paperList = '<p>Publication sources could not be loaded. Reopen this panel to retry.</p>';
    else if (rate == null || !works) paperList = '<p>A publication rate is unavailable for this graduate and window.</p>';
    else {
      const counted = works.filter(inWindow);
      const items = counted.map(([year,group,title,journal,source,doi,citation]) => {
        const reviewedSource = safeURL(source);
        const doiURL = doi && `https://doi.org/${encodeURI(doi)}`;
        const link = doiURL && doiURL !== reviewedSource
          ? ` <a href="${escape(doiURL)}" target="_blank" rel="noopener noreferrer">DOI ↗</a>` : '';
        const provenance = reviewedSource
          ? `<a href="${escape(reviewedSource)}" target="_blank" rel="noopener noreferrer">Publication source ↗</a>`
          : escape(source);
        return `<li>${escape(title)} · ${escape(journal)} · ${year} · ${publications.journalSet!=='custom' && group === 2 ? '0.5 credit' : '1 credit'} · ${provenance}${link}${citationLink(citation)}</li>`;
      });
      paperList = `<p>${from}–${publications.endYear} · ${contributionText(rate)} credits per year</p>${items.length
        ? `<ul>${items.join('')}</ul>` : '<p>No counted articles in this window.</p>'}`;
    }
    const citationList = rows => rows.map(([year,,title,journal,source,doi,citation]) => {
      const publication = safeURL(source) || (doi && `https://doi.org/${encodeURI(doi)}`);
      const link = publication ? ` · <a href="${escape(publication)}" target="_blank" rel="noopener noreferrer">Publication ↗</a>` : '';
      return `<li>${escape(title)} · ${escape(journal)} · ${year}${link}${citationLink(citation)}</li>`;
    }).join('');
    const otherCitations = citationList((works || []).filter(work =>
      (work[6] || (work[5] && safeURL(work[4]))) && !inWindow(work)));
    const employerCitations = employer && articles.status === 'fulfilled'
      ? citationList(articles.value.employerCitations?.[graduate.destination.school_id] || []) : '';
    const jobEvidence = detailed ? sourceBlock('Doctoral education', detailed.evidence.phd) +
      sourceBlock(heading, current ? detailed.evidence.job : []) : '<p>Placement sources could not be loaded. Reopen this panel to retry.</p>';
    content.innerHTML = `<h2 id="dialog-title">${escape(graduate.name)}</h2>${jobEvidence}
      <section class="evidence-block"><h3>Counted graduate publications</h3>${paperList}</section>
      ${otherCitations ? `<details class="evidence-block"><summary>Other graduate publication records since 2005</summary><ul>${otherCitations}</ul></details>` : ''}
      ${employer ? `<section class="evidence-block"><h3>Employer faculty publication evidence</h3><ul>${publicationEvidenceCounts.map(([key,label]) => `<li>${number(employer[key])} ${key === 'reviewedZero' && employer[key] === 1 ? 'reviewed zero' : label}</li>`).join('')}</ul>${employerCitations ? `<details><summary>Employer publication records since 2005</summary><ul>${employerCitations}</ul></details>` : ''}</section>` : ''}
      ${current && graduate.scored ? `<p>Employer score contribution after adjustments · ${contributionText(graduate.contribution)}</p>` : ''}
      ${cv ? `<a class="dialog-source-link" href="${escape(cv)}" target="_blank" rel="noopener noreferrer">Open faculty CV ↗</a>` : ''}`;
  }
  function showEvidence(id, sid, trigger) {
    const row = findRow(sid);
    const sourceBlock = (title, sources) => `<section class="evidence-block"><h3>${title}</h3>${sources.length ? sources.map(s => `<blockquote>${escape(s.snapshot || s.excerpt || 'No source excerpt supplied.')}</blockquote>${safeURL(s.url) ? `<a class="dialog-source-link" href="${escape(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ''}`).join('') : '<p>No source supplied for this record.</p>'}</section>`;
    if (publicationData) {
      showDemoEvidence(row,id,sid,trigger,sourceBlock);
      return;
    }
    const g = row?.windows.all.graduates.find(x => x.facultyId === id);
    if (!g) return;
    openDialog(g.isSynthetic ? 'SYNTHETIC RECORD / EVIDENCE' : 'GRADUATE / EVIDENCE', `<h2 id="dialog-title">${escape(g.name)}</h2><p>${g.isSynthetic ? 'Fictional demonstration record.' : 'Supplied PhD and appointment evidence.'}</p><div class="evidence-meta"><div><strong>DOCTORAL ORIGIN</strong>${escape(g.originUnit?.name || g.origin.name)} · ${g.phdYear ?? 'Undated'}</div><div><strong>SELECTED DESTINATION</strong>${escape(appointmentLabel(g))}</div><div><strong>APPOINTMENT RULE</strong>${escape(optionLabel(options.appointments,state.appointment))}</div><div><strong>SCORE CONTRIBUTION</strong>${g.eligibleForCredit === false || g.outsideDestinationSample ? '0 · Listing receives no ranking points' : contributionText(g.contribution)}${g.isSelfPlacement ? ` · Self placement${g.selfPlacementFactor < 1 ? ` · ${Math.round(100 * g.selfPlacementFactor)}% of input after cap` : ''}` : ''}${g.creditWeight < 1 ? ` · ${Math.round(100 * g.creditWeight)}% joint-degree credit` : ''} · ${escape(result.mode.shortLabel)}</div></div>${sourceBlock('Doctoral education',g.evidence.phd)}${sourceBlock('Academic appointment',g.evidence.job)}${safeURL(g.cvUrl) ? `<a class="dialog-source-link" href="${escape(safeURL(g.cvUrl))}" target="_blank" rel="noopener noreferrer">Open faculty CV ↗</a>` : ''}`, trigger);
  }
  function goToSection(id) {
    const target = document.getElementById(id);
    if (!target) {
      if (publicationData && ['data','corrections','remove-your-data'].includes(id)) location.replace(`/rankings/data/#${id}`);
      return;
    }
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  function showError(error) {
    result = null;
    $('#results').setAttribute('aria-busy','false');
    $('#result-summary').textContent = 'The dataset could not be loaded.';
    if ($('#program-count')) $('#program-count').textContent = '—';
    $('#data-warning').hidden = true;
    $('#rankings-body').innerHTML = `<tr><td colspan="${columnCount()}"><div class="empty-state"><strong>Unable to load rankings</strong>${escape(error.message || 'Unknown data error')}<br><button class="error-retry" data-retry>Try again</button></div></td></tr>`;
    $('#export-button').disabled = true;
    $('#status').textContent = `Error: ${error.message}`;
  }
  function exportCSV() {
    const rows = flattenedRows();
    const cell = value => {
      let text = String(value ?? '');
      if (text !== '-' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g,'""')}"`;
    };
    const groupHeaders = ['Rank', 'PhD Granter, Location', 'Σ Top-3s/year at destinations', ...Array(SCORE_WINDOWS.length - 1).fill(''), '# grads',
      ...SOURCE_IDS.flatMap(id => [sourceHeading(id), ...Array(SOURCE_EXPORT_WINDOWS.length - 1).fill('')])];
    const columnHeaders = ['', '', ...SCORE_WINDOWS.map(windowLabel), 'All',
      ...SOURCE_IDS.flatMap(() => SOURCE_EXPORT_WINDOWS.map(sourceWindowLabel))];
    const lines = publicationData ? [
      ['Rank', 'PhD Granter, Location',
        ...demoColumns.map(([key,label]) => key === 'tracked' ? label : `${label} (${demoScoreUnit})`),
        ...['Graduates', 'Employer faculty'].flatMap(label =>
          publicationEvidenceCounts.map(([,status]) => `${label} · ${status}`))],
      ...rows.map(row => [row.isUnit ? '' : displayedRankText(row),
        `${programLabel(row)}${row.isUnit ? '' : ` ${locationLabel(row.school)}`}`,
        ...demoColumns.map(([key]) => demoScore(row,key) ?? ''),
        ...[row.graduateRate, row.currentJobEvidence].flatMap(counts =>
          publicationEvidenceCounts.map(([key]) => counts?.[key] ?? ''))])
    ] : [groupHeaders, columnHeaders, ...rows.map(r => [
      r.isUnit ? '' : displayedRankText(r),
      `${programLabel(r)}${r.isUnit ? '' : ` ${locationLabel(r.school)}`}`,
      ...SCORE_WINDOWS.map(years => mainScoreText(r.windows[String(years)].displayScore)),
      number(r.allTimeGraduateCount),
      ...(minimumCellSuppressed(r) && SOURCE_IDS.length ? [MINIMUM_CELL_MESSAGE, ...Array(SOURCE_EXPORT_WINDOWS.length*SOURCE_IDS.length-1).fill('')] : SOURCE_IDS.flatMap(id => SOURCE_EXPORT_WINDOWS.map(years => {
        const metric = r.windows[String(years)];
        const sourceRow = {isUnit: r.isUnit, sourceRanks: metric.sourceRanks, sourceStatuses: metric.sourceStatuses};
        return sourceValueText(sourceRow, id);
      })))
    ])];
    const blob = new Blob(['\ufeff',lines.map(r => r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url;
    const period = publicationData
      ? result.cohort.startYear == null ? 'all' : `${result.cohort.startYear}-${result.cohort.endYear}`
      : 'all-periods';
    const publicationSuffix = publicationData
      ? `-${result.publications.windowYears}yr-journals${result.publications.journalSet}-${result.publications.weight}`
      : '';
    link.download = `finance-placement-${state.appointment}-${state.universe}-${period}${publicationSuffix}${result.meta.is_synthetic ? '-SYNTHETIC' : ''}.csv`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  function positionExplanation(popover, anchor) {
    if (!anchor?.isConnected || !popover.matches(':popover-open')) return;
    const trigger = anchor.getBoundingClientRect(), box = popover.getBoundingClientRect();
    popover.style.left = `${Math.max(10,Math.min(trigger.right - box.width,innerWidth - box.width - 10))}px`;
    const below = trigger.bottom + 8;
    popover.style.top = `${Math.max(10,Math.min(below + box.height <= innerHeight - 10 ? below : trigger.top - box.height - 8,innerHeight - box.height - 10))}px`;
  }
  function positionCoverage() { positionExplanation($('#coverage-popover'), coverageTrigger); }
  function positionSelfPlacement() { positionExplanation($('#self-placement-popover'), selfPlacementTrigger); }
  function closeRegion(restoreFocus = false) {
    $('#region-menu').hidden = true;
    $('#region-filter').setAttribute('aria-expanded','false');
    if (restoreFocus) $('#region-filter').focus({preventScroll:true});
  }
  function positionRegion() {
    if ($('#region-menu')?.hidden !== false) return;
    const trigger = $('#region-filter').getBoundingClientRect(), menu = $('#region-menu');
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(10,Math.min(trigger.left,innerWidth - rect.width - 10))}px`;
    menu.style.top = `${Math.max(10,Math.min(trigger.bottom + 8,innerHeight - rect.height - 10))}px`;
  }
  $('#coverage-popover').addEventListener('toggle',event => { if (event.newState === 'open') positionCoverage(); });
  window.addEventListener('resize',positionCoverage);
  document.addEventListener('scroll',positionCoverage,true);
  $('#self-placement-popover').addEventListener('toggle',event => { if (event.newState === 'open') positionSelfPlacement(); });
  window.addEventListener('resize',positionSelfPlacement);
  document.addEventListener('scroll',positionSelfPlacement,true);
  $('#region-filter')?.addEventListener('click',() => {
    const open = $('#region-menu').hidden;
    $('#region-menu').hidden = !open;
    $('#region-filter').setAttribute('aria-expanded',String(open));
    if (open) {
      positionRegion();
      $('#region-menu [aria-checked="true"]')?.focus({preventScroll:true});
    }
  });
  $('#region-close')?.addEventListener('click',() => closeRegion(true));
  window.addEventListener('resize',positionRegion);
  document.addEventListener('scroll',positionRegion,true);
  document.addEventListener('click',event => {
    const selfPlacement = event.target.closest('[data-self-cap]');
    if (selfPlacement) { selfPlacementTrigger = selfPlacement; return; }
    const coverage = event.target.closest('[data-coverage]');
    if (coverage) { coverageTrigger = coverage; return; }
    if (event.target.closest('#coverage-popover [data-section]')) $('#coverage-popover').hidePopover();
    if (!publicationData && !event.target.closest('#region-menu') && !event.target.closest('#region-filter')) closeRegion();
    const radio = event.target.closest('button[data-key]');
    if (radio && options) {
      tablePage = 0;
      state[radio.dataset.key] = radio.dataset.key === 'years' && radio.dataset.value !== 'all' ? Number(radio.dataset.value) : radio.dataset.value;
      if (radio.dataset.key === 'universe') closeRegion(true);
      if (radio.dataset.key === 'years') sort = { key: `score:${state.years}`, descending: true };
      refresh(); return;
    }
    const expand = event.target.closest('[data-expand]');
    const groupRow = !event.target.closest('button,a,input') && event.target.closest('.program-row[data-group]');
    if (expand || groupRow) {
      const id = expand?.dataset.expand || groupRow.dataset.group;
      const member = expand?.dataset.member || id;
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      renderTable();
      const buttons = [...document.querySelectorAll('[data-expand]')].filter(b => b.dataset.expand === id);
      (buttons.find(b => b.dataset.member === member) || buttons[0])?.focus({preventScroll:true});
      return;
    }
    const evidence = event.target.closest('[data-evidence]');
    if (evidence) { showEvidence(evidence.dataset.evidence,evidence.dataset.origin,evidence); return; }
    const sortButton = event.target.closest('[data-sort],[data-sort-default]');
    if (sortButton) {
      tablePage = 0;
      const key = sortButton.dataset.sort || sortButton.dataset.sortDefault;
      sort = { key, descending: key !== 'rank' && !key.startsWith('sub:') };
      if (key.startsWith('score:') || key.startsWith('sub:')) {
        const period=key.startsWith('score:')?key.slice(6):key.split(':')[2];
        const years = period === 'all' ? 'all' : Number(period);
        if (SCORE_WINDOWS.includes(years) && state.years !== years) { state.years = years; refresh(); return; }
      }
      renderTable(); return;
    }
    const sectionLink = event.target.closest('[data-section]');
    if (sectionLink && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); goToSection(sectionLink.dataset.section); return; }
    if (event.target.closest('[data-retry-details]')) { loadFacultyDetails(); return; }
    if (event.target.closest('[data-retry]')) initialize();
  });
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape' && $('#region-menu')?.hidden === false) { closeRegion(true); event.preventDefault(); }
    const group = event.target.closest('[role="radiogroup"]');
    if (!group || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...group.querySelectorAll('[role="radio"]')], current = buttons.indexOf(document.activeElement);
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next].focus(); buttons[next].click();
  });
  schoolSearch?.addEventListener('input', () => {
    query = schoolSearch.value;
    tablePage = 0;
    if (state.universe && state.universe !== 'all') {
      state.universe = 'all';
      refresh();
    } else if (result) renderTable();
  });
  const cohortForm = $('#demo-placement-cohort');
  let customEditor, renderCustomJournals;
  if (cohortForm && publicationData?.journals) {
    const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(cls)node.className=cls;return node;};
    customEditor=make('div',null,'tenure-peer-editor journal-custom-editor'); customEditor.hidden=true;
    const label=make('label','Add:'), input=make('input'), list=make('datalist');
    input.type='search';input.placeholder='Search journals';input.autocomplete='off';input.setAttribute('aria-label','Add a journal');input.setAttribute('list','finance-phd-journal-options');list.id='finance-phd-journal-options';
    publicationData.journals.forEach(name=>{const item=make('option');item.value=name;list.append(item);});
    window.JournalLabels.attach(input,list);
    const current=make('div',null,'journal-custom-current'), chips=make('div',null,'journal-custom-chips');
    current.append(make('strong','Current:'),chips);label.append(input);customEditor.append(label,list,current);cohortForm.after(customEditor);
    renderCustomJournals=()=>{
      window.JournalLabels.update(list,name=>customJournals.has(name));
      chips.replaceChildren();
      [...customJournals].sort((a,b)=>a.localeCompare(b)).forEach(name=>{const button=make('button',`${name} ×`,'secondary-button');button.type='button';button.setAttribute('aria-label',`Remove ${name}`);button.disabled=customJournals.size===1;if(button.disabled)button.title='At least one journal is required';button.addEventListener('click',()=>{if(customJournals.size>1){customJournals.delete(name);renderCustomJournals();tablePage=0;refresh();}});chips.append(button);});
    };
    input.addEventListener('input',()=>{const name=publicationData.journals.find(name=>name.toLowerCase()===input.value.trim().toLowerCase());if(name){customJournals.add(name);input.value='';renderCustomJournals();tablePage=0;refresh();}});
    input.addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});
  }
  function syncGraduationRange() {
    const { from, to } = cohortForm.elements;
    from.value = state.graduationRange.from;
    to.value = state.graduationRange.to;
    to.setCustomValidity('');
    schoolSearch.value = query || (state.universe === 'all' ? '' : optionLabel(options.universes,state.universe));
    markSchoolFilter?.();
    $('#demo-publication-journals').value = state.journals;
    if(customEditor){customEditor.hidden=state.journals!=='custom';if(!customEditor.hidden)renderCustomJournals();}
    $('#demo-publication-window').value = state.window;
  }
  function applyGraduationRange(force = false) {
    const { from, to } = cohortForm.elements;
    const start = from.valueAsNumber, end = to.valueAsNumber;
    to.setCustomValidity(start > end ? 'Enter an end year at or after the start year.' : '');
    if (!cohortForm.reportValidity()) return;
    if (!force && state.graduationRange?.from === start && state.graduationRange?.to === end) return;
    state.years = 'all';
    state.graduationRange = {from:start,to:end};
    tablePage = 0;
    refresh();
  }
  cohortForm?.addEventListener('change', event => {
    if(event.target.id==='demo-publication-journals' && customEditor){state.journals=event.target.value;customEditor.hidden=state.journals!=='custom';if(!customEditor.hidden){renderCustomJournals();customEditor.querySelector('input').focus();}}
    if (options) applyGraduationRange(!['from','to'].includes(event.target.name));
  });
  cohortForm?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.type === 'number') {
      event.preventDefault();
      applyGraduationRange();
    }
  });
  cohortForm?.addEventListener('submit', event => {
    event.preventDefault();
    applyGraduationRange();
  });
  $('#table-page-size').addEventListener('change',event => {
    const requested = Number(event.target.value);
    if (!PAGE_SIZES.includes(requested)) return;
    pageSize = requested; tablePage = 0; renderTable();
  });
  for (const id of ['#table-page-prev', '#table-page-prev-top']) $(id)?.addEventListener('click',() => { if (tablePage > 0) { tablePage--; renderTable(); } });
  for (const id of ['#table-page-next', '#table-page-next-top']) $(id)?.addEventListener('click',() => {
    if ((tablePage + 1) * pageSize < visibleRows().length) { tablePage++; renderTable(); }
  });
  $('#export-button').addEventListener('click',exportCSV);
  $('#data-download')?.addEventListener('click',downloadPublicData);
  $('#data-download-link')?.addEventListener('click',event => { event.preventDefault(); downloadPublicData(); });
  $('#dialog-close').addEventListener('click',() => $('#detail-dialog').close());
  $('#detail-dialog').addEventListener('close',() => lastDialogTrigger?.focus({preventScroll:true}));
  $('#detail-dialog').addEventListener('click',event => {
    if (event.target !== $('#detail-dialog')) return;
    const r = $('#detail-dialog').getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('#detail-dialog').close();
  });
  window.addEventListener('hashchange',() => {
    const section = location.hash.slice(1);
    if (PAGE_SECTIONS.includes(section)) { goToSection(section); return; }
    if (options) {
      state = readHash();
      sort = state.sort || initialSort(state.years);
      if (cohortForm) syncGraduationRange();
      refresh();
    }
  });
  async function loadFacultyDetails() {
    try {
      await middleware.loadFullData(); overviewCache.clear(); await refresh();
    } catch (error) {
      $('#data-download-note').textContent = 'Faculty details could not be loaded. The ranking table remains available.';
      renderTable();
    }
  }
  async function initialize() {
    try {
      middleware = await window.createAppMiddleware();
      if (typeof middleware?.getOptions !== 'function' || typeof middleware?.getRankings !== 'function') throw new Error('Middleware must provide getOptions() and getRankings().');
      options = await middleware.getOptions();
      overviewCache.clear();
      const section = location.hash.slice(1);
      state = readHash(); sort = state.sort || initialSort(state.years);
      if (cohortForm) syncGraduationRange();
      buildControls(); await refresh();
      if (typeof middleware.loadFullData === 'function' && !publicationData) loadFacultyDetails();
      if (PAGE_SECTIONS.includes(section)) goToSection(section);
    } catch (error) { showError(error); }
  }
  if ('ResizeObserver' in window) {
    new ResizeObserver(updateFrozenColumns).observe($('.table-scroll'));
  }
  window.addEventListener('resize',updateFrozenColumns);
  initialize();
})();
