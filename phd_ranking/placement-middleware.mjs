/** Real draft data adapter for the v5 presentation contract. No provider raw
 * scores are accepted here: destinations use the two precomputed meta inputs. */
const REGIONS = [
  { id: 'all', label: 'All' }, { id: 'us', label: 'US' },
  { id: 'intl', label: 'Intl' }, { id: 'canada', label: 'Canada' },
  { id: 'europe', label: 'Europe' }, { id: 'asia', label: 'Asia' }
];
const APPOINTMENTS = [
  { id: 'current', label: 'Current listed', description: 'Highest Top-3 destination score among eligible current faculty appointments. Website support is recorded where available; primary and tenure status may be unknown.' },
  { id: 'best', label: 'Best observed', description: 'Highest-scoring observed listed faculty appointment; not a complete career history.' },
  { id: 'first', label: 'First verified', description: 'Requires a verified first faculty appointment or complete employment history. This batch does not supply those histories.' }
];
const copy = value => structuredClone(value);
const SOURCE_NAMES = {
  asu_research: 'ASU', qs_accounting_and_finance: 'QS',
  times_higher_education_business_and_econ: 'THE',
  us_news_business_and_econ: 'U.S. News', ut_dallas_business_research: 'UT Dallas'
};
const modeDescription = {
  average_score_weighted: 'Arithmetic mean of normalized component impacts; source-specific top-50 cutoffs are applied once.',
  average_ranking_weighted: 'Average (5 + rank)^−0.5, ignoring up to two missing rankings and imputing zero for additional gaps.'
};
const inRegion = (school, region) => region === 'all' ||
  (region === 'us' && school.country_code === 'US') ||
  (region === 'intl' && !!school.country_code && school.country_code !== 'US') ||
  (region === 'canada' && school.country_code === 'CA') ||
  (region === 'europe' && school.region === 'Europe') ||
  (region === 'asia' && school.region === 'Asia');

export function isEligibleFacultyJob(role, asOfYear) {
  const type = String(role.appointment_type || '').toLowerCase().replace(/[ -]+/g, '_');
  // A former deanship does not turn an active professorship into an emeritus job.
  const title = String(role.position_title || '').replace(/\b(?:dean|president|director|head)\s+emerit(?:us|a)\b/gi, '');
  return role.role_type === 'job' && role.is_primary !== false && role.finance_unit_eligibility !== false &&
    !['visiting', 'visitor', 'postdoc', 'postdoctoral', 'teaching', 'teaching_only', 'courtesy',
      'emeritus', 'emerita', 'honorary', 'practice', 'professor_of_practice', 'non_primary', 'actuarial_science'].includes(type) &&
    !/\b(?:emerit(?:us|a)|honorary|visiting|postdoc(?:toral)?)\b|\bprofessor\s+(?:of\s+(?:professional\s+)?practice|in\s+the\s+practice)\b|\bby\s+courtesy\b/i.test(title) &&
    role.field !== 'actuarial_science' && (role.start_year == null || role.start_year <= asOfYear);
}

export function countCurrentFinanceFaculty(data) {
  const schools = new Map(data.schools.map(s => [s.school_id,s]));
  const affiliations = new Map();
  const finance = new Set(data.faculty.filter(p => p.field === 'finance').map(p => p.faculty_id));
  for (const role of data.faculty_roles) {
    if (!finance.has(role.faculty_id) || !isEligibleFacultyJob(role, data.meta.as_of_year) ||
        role.is_current === false || role.end_year != null && role.end_year < data.meta.as_of_year ||
        role.start_year != null && role.start_year > data.meta.as_of_year) continue;
    let school = schools.get(role.school_id);
    const visited = new Set();
    while (school?.parent_school_id) {
      if (visited.has(school.school_id)) throw new Error('School hierarchy cycle.');
      visited.add(school.school_id);
      school = schools.get(school.parent_school_id);
    }
    if (!school) throw new Error('Unknown faculty affiliation.');
    if (!affiliations.has(role.faculty_id)) affiliations.set(role.faculty_id,new Set());
    affiliations.get(role.faculty_id).add(school.school_id);
  }
  const counts = {};
  for (const destinations of affiliations.values()) {
    // A genuine simultaneous appointment contributes one person to each
    // university's headcount. Placement credit still selects only one job.
    for (const id of destinations) counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

export function createMiddleware(data) {
  for (const key of ['schools', 'faculty', 'faculty_roles', 'destination_inputs']) {
    if (!Array.isArray(data[key])) throw new Error(`Invalid ${key} data.`);
  }
  const schools = new Map(data.schools.map(s => [s.school_id, s]));
  const people = new Map(data.faculty.map(p => [p.faculty_id, p]));
  if (schools.size !== data.schools.length || people.size !== data.faculty.length) throw new Error('Duplicate school or faculty ID.');
  const universityOf = id => {
    const visited = new Set();
    let school = schools.get(id);
    if (!school) throw new Error('Unknown affiliation school.');
    while (school.parent_school_id) {
      if (visited.has(school.school_id)) throw new Error('School hierarchy cycle.');
      visited.add(school.school_id);
      school = schools.get(school.parent_school_id);
      if (!school) throw new Error('Unknown parent institution.');
    }
    return school;
  };
  for (const school of schools.values()) universityOf(school.school_id);
  const byPerson = new Map();
  const roleIds = new Set();
  for (const role of data.faculty_roles) {
    if (!people.has(role.faculty_id) || !schools.has(role.school_id) || roleIds.has(role.role_id)) throw new Error('Invalid or duplicate faculty role.');
    roleIds.add(role.role_id);
    if (role.origin_affiliations) {
      const affiliations = role.origin_affiliations;
      if (!Array.isArray(affiliations) || affiliations.length < 2 ||
          affiliations.some(a => !schools.has(a.school_id) || !Number.isFinite(a.credit_weight) || a.credit_weight <= 0) ||
          Math.abs(affiliations.reduce((sum, a) => sum + a.credit_weight, 0) - 1) > 1e-12 ||
          new Set(affiliations.map(a => universityOf(a.school_id).school_id)).size !== affiliations.length) {
        throw new Error('Joint PhD affiliations require distinct universities and positive credits summing to one.');
      }
    }
    if (!byPerson.has(role.faculty_id)) byPerson.set(role.faculty_id, []);
    byPerson.get(role.faculty_id).push(role);
  }
  const modes = data.destination_inputs.map(block => {
    const label = data.ranking_metadata.ranking_options.find(o => o.ranking_type === block.ranking_type)?.label || block.ranking_type;
    return { id: block.ranking_type, label, shortLabel: label,
      description: data.program_ranking_metadata?.composite_policy?.method === 'mean_of_available_annual_article_counts'
        ? 'Sum destination schools’ unadjusted top-three finance articles per year, averaging available ASU and UTD counts.'
        : data.program_ranking_metadata?.composite_policy?.enabled
        ? 'Average available ASU/UTD scores after faculty-size adjustment and separate Stanford normalization.'
        : modeDescription[block.ranking_type] || '' };
  });
  const destinationSample = data.destination_sample ? new Set(data.destination_sample.school_names) : null;
  const inDestinationSample = school => !destinationSample || destinationSample.has((school.scoring_name || school.name).trim());
  const referenceId = data.program_ranking_metadata?.normalization?.school_id;
  const zeroAnchorRank = data.program_ranking_metadata?.normalization?.zero_anchor_rank;
  if (zeroAnchorRank != null && (!Number.isInteger(zeroAnchorRank) || zeroAnchorRank < 1 || !referenceId)) throw new Error('Invalid zero-anchor normalization.');
  const referenceSchool = referenceId ? universityOf(referenceId) : null;
  const referenceName = referenceSchool && (referenceSchool.scoring_name || referenceSchool.name).trim();
  const referenceValue = (value, context) => {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Missing positive normalization reference for ${context}.`);
    return value;
  };
  const inputs = new Map(data.destination_inputs.map(b => {
    if (b.weights_are_final || b.is_normalized) {
      if (b.scores.some(row => row.score != null && (!Number.isFinite(row.score) || row.score < 0))) throw new Error('Invalid final destination impact.');
      return [b.ranking_type, new Map(b.scores.map(row => [row.school_name.trim(), row.score]))];
    }
    const maximum = data.destination_reference_maxima?.[b.ranking_type] ?? Math.max(0, ...b.scores.map(r => r.score ?? 0));
    const zeroAnchor = zeroAnchorRank == null ? 0 : data.destination_zero_anchors?.[b.ranking_type] ??
      b.scores.map(r => r.score).filter(Number.isFinite).sort((a, b) => b - a)[zeroAnchorRank - 1];
    if (!Number.isFinite(zeroAnchor)) throw new Error(`Missing rank-${zeroAnchorRank} normalization anchor for ${b.ranking_type}.`);
    const divisor = referenceName ? referenceValue(b.scores.find(r => r.school_name.trim() === referenceName)?.score - zeroAnchor, b.ranking_type) : maximum;
    return [b.ranking_type, new Map(b.scores.map(r => [r.school_name.trim(),
      r.score == null ? null : divisor > 0 ? Math.max(0, (r.score - zeroAnchor) / divisor) : r.score === 0 ? 0 : null]))];
  }));
  const recursiveModel = data.program_ranking_metadata?.models?.find(model => model.ranking_type === 'recursive_10');
  const recursiveMode = recursiveModel?.ranking_type;
  if (recursiveModel && inputs.has(recursiveModel.seed_mode)) {
    if (!Number.isInteger(recursiveModel.iterations) || recursiveModel.iterations !== 10 || recursiveModel.missing_program_weight !== 0) {
      throw new Error('Recursive ranking requires ten iterations and zero for missing programs.');
    }
    modes.push({id: recursiveMode, label: recursiveModel.label, shortLabel: recursiveModel.label, description: recursiveModel.description});
    inputs.set(recursiveMode, new Map(inputs.get(recursiveModel.seed_mode)));
  }
  let recursivePreparation, recursiveInfo;
  function prepareRecursiveWeights() {
    if (!recursivePreparation) recursivePreparation = (async () => {
      // The seed pass establishes one fixed, global placement graph. Joint
      // doctoral credits are already allocated on each graduate record.
      const seed = await getRankings({ ...recursiveModel.calibration, mode: recursiveModel.seed_mode });
      const roots = data.schools.filter(school => !school.parent_school_id);
      let weights = new Map(inputs.get(recursiveModel.seed_mode));
      const history = [];
      for (let iteration = 1; iteration <= recursiveModel.iterations; iteration++) {
        let cappedPrograms = 0, maximumSelfScoreShare = 0;
        const scores = new Map(seed.rows.map(row => {
          let externalScore = 0, selfScore = 0;
          for (const graduate of row.graduates) {
            const contribution = (weights.get((graduate.destination.scoring_name || graduate.destination.name).trim()) ?? 0) * graduate.creditWeight;
            if (graduate.isSelfPlacement) selfScore += contribution;
            else externalScore += contribution;
          }
          const creditedSelfScore = selfPlacementRule?.enabled
            ? Math.min(selfScore, externalScore * selfPlacementRule.max_self_to_external_score) : selfScore;
          if (creditedSelfScore < selfScore) cappedPrograms++;
          const score = externalScore + creditedSelfScore;
          maximumSelfScoreShare = Math.max(maximumSelfScoreShare, score > 0 ? creditedSelfScore / score : 0);
          return [row.school.school_id, score];
        }));
        const maximum = Math.max(0, ...scores.values());
        const divisor = referenceId ? referenceValue(scores.get(referenceId), `recursive iteration ${iteration}`) : maximum;
        const next = new Map(roots.map(school => [(school.scoring_name || school.name).trim(),
          divisor > 0 ? (scores.get(school.school_id) ?? 0) / divisor : 0]));
        history.push({iteration, largestProgramTotal: maximum, normalizationReferenceTotal: divisor,
          cappedPrograms, maximumSelfScoreShare,
          maximumWeightChange: Math.max(0, ...roots.map(school => {
            const name = (school.scoring_name || school.name).trim();
            return Math.abs((next.get(name) ?? 0) - (weights.get(name) ?? 0));
          }))});
        weights = next;
      }
      inputs.set(recursiveMode, weights);
      recursiveInfo = {iterations: recursiveModel.iterations, seedMode: recursiveModel.seed_mode,
        calibration: recursiveModel.calibration, normalizationSchoolId: referenceId || null, missingProgramWeight: 0, history};
    })();
    return recursivePreparation;
  }
  const storedSourceRanks = data.source_program_ranks;
  // Score input is supported for private build calculations and fixtures.
  const sourceMetrics = storedSourceRanks || data.source_program_scores;
  const sourceColumns = sourceMetrics ? data.ranking_metadata.sources.map(s =>
    ({id: s.ranking_type, name: SOURCE_NAMES[s.ranking_type] || s.label, label: s.label})) : [];
  const recursiveSubscore = data.program_ranking_metadata?.recursive_subscore;
  if (sourceMetrics && recursiveSubscore) {
    sourceColumns.push({id: recursiveSubscore.ranking_type, name: recursiveSubscore.label,
      label: recursiveSubscore.description, isRecursive: true});
  }
  const minimumCellSize = data.program_ranking_metadata?.minimum_cell_size;
  const options = { meta: data.meta, modes, universes: REGIONS, appointments: APPOINTMENTS, sourceColumns,
    minimumCellSize: minimumCellSize || null,
    compositePolicy: data.program_ranking_metadata?.composite_policy || null,
    defaults: { mode: 'average_score_weighted', universe: 'all', years: 10, appointment: 'current' } };
  const weight = (mode, id) => inputs.get(mode).get((universityOf(id).scoring_name || universityOf(id).name).trim()) ?? null;
  const isCurrent = role => role.is_current !== false && (role.end_year == null || role.end_year >= data.meta.as_of_year);
  const evidence = sources => (sources || []).flatMap(s => {
    const urls = typeof s.source_url === 'string' ? s.source_url.split(/;\s*(?=https?:\/\/)/i) : [s.source_url];
    return urls.map(url => ({ ...s, source_url: url, url, snapshot: s.source_snapshot,
      ...(urls.length > 1 ? {combined_source_url: s.source_url} : {}) }));
  });

  function chooseJob(person, roles, config, diagnostics) {
    const jobs = roles.filter(r => isEligibleFacultyJob(r, data.meta.as_of_year));
    if (!jobs.length) { diagnostics.noQualifyingJob++; return null; }
    if (config.appointment === 'first') {
      if (jobs.some(r => !Number.isInteger(r.start_year))) { diagnostics.missingJobDates++; return null; }
      const firstYear = Math.min(...jobs.map(r => r.start_year));
      const first = jobs.filter(r => r.start_year === firstYear);
      if (new Set(first.map(r => universityOf(r.school_id).school_id)).size > 1) { diagnostics.ambiguousAppointment++; return null; }
      if (!person.employment_history_complete && !first.some(r => r.is_verified_first)) { diagnostics.unverifiedFirst++; return null; }
      return { job: first.sort((a, b) => a.role_id.localeCompare(b.role_id))[0], incompleteBest: false };
    }
    if (config.appointment === 'current') {
      const current = jobs.filter(isCurrent);
      if (!current.length) { diagnostics.noCurrentJob++; return null; }
      current.sort((a, b) => (weight(config.mode, b.school_id) ?? -Infinity) - (weight(config.mode, a.school_id) ?? -Infinity) ||
        Number(b.is_primary === true) - Number(a.is_primary === true) || (b.start_year || 0) - (a.start_year || 0) || a.role_id.localeCompare(b.role_id));
      return { job: current[0], incompleteBest: false };
    }
    const scored = jobs.map(job => ({ job, value: weight(config.mode, job.school_id) }));
    scored.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.job.role_id.localeCompare(b.job.role_id));
    return { job: scored[0].job, incompleteBest: scored.some(r => r.value === null) };
  }

  const selfPlacementRule = data.program_ranking_metadata?.self_placements;
  if (selfPlacementRule?.enabled && (!Number.isFinite(selfPlacementRule.max_self_to_external_score) || selfPlacementRule.max_self_to_external_score < 0)) {
    throw new Error('Invalid self-placement score cap.');
  }
  async function getSelfPlacementOverview(request = {}) {
    const result = await getRankings({years: 'all', ...request, universe: 'all'});
    const schools = result.rows.map(row => {
        const selfCount = row.graduates.filter(g => g.isSelfPlacement).length;
        return {school_id: row.school.school_id, school_name: row.school.name,
          recorded_placements: row.graduateCount, self_placements: selfCount,
          self_placement_share: selfCount / row.graduateCount, ...row.selfPlacementCap,
          capped_score: row.score};
      }).sort((a, b) => a.school_name.localeCompare(b.school_name));
    const ranked = result.rows.filter(row => row.hasScore);
    const affected = ranked.filter(row => row.selfPlacementCap.uncapped_score - row.score > 1e-12);
    const firstAffectedScore = Math.max(-Infinity, ...affected.map(row => row.selfPlacementCap.uncapped_score));
    return {enabled: !!selfPlacementRule?.enabled, max_self_to_external_score: selfPlacementRule?.max_self_to_external_score ?? null,
      config: result.config, schools,
      unaffected_top_count: affected.length ? ranked.filter(row => row.selfPlacementCap.uncapped_score > firstAffectedScore + 1e-12).length : ranked.length};
  }
  async function getRankings(request = {}) {
    const config = { ...options.defaults, ...request };
    if (!inputs.has(config.mode) || !REGIONS.some(r => r.id === config.universe) ||
        ![10, 20, 'all'].includes(config.years) || !APPOINTMENTS.some(r => r.id === config.appointment)) throw new Error('Invalid ranking filter.');
    if (config.mode === recursiveMode) await prepareRecursiveWeights();
    const endYear = data.meta.as_of_year, startYear = config.years === 'all' ? null : endYear - config.years + 1;
    const diagnostics = { missingPhd: 0, ambiguousPhd: 0, missingYear: 0, unverifiedPhd: 0, outsideCohort: 0, undatedIncluded: 0,
      noQualifyingJob: 0, noCurrentJob: 0, ambiguousAppointment: 0, missingJobDates: 0, unverifiedFirst: 0, missingScore: 0,
      outsideDestinationSample: 0, selfPlacementsAdjusted: 0 };
    const groups = new Map();
    for (const person of data.faculty) {
      if (person.field !== 'finance') continue;
      const roles = byPerson.get(person.faculty_id) || [], phds = roles.filter(r => r.role_type === 'phd');
      if (!phds.length) { diagnostics.missingPhd++; continue; }
      let phd = phds[0];
      if (phds.length > 1) {
        // Do not turn separate awards into joint credit or fall back to an
        // earlier doctorate merely because the latest falls outside a cohort.
        const completed = phds.filter(r => r.end_year == null || r.end_year <= endYear);
        const candidates = completed.length ? completed : phds;
        if (candidates.some(r => !Number.isInteger(r.end_year))) { diagnostics.ambiguousPhd++; continue; }
        const latestYear = Math.max(...candidates.map(r => r.end_year));
        const latest = candidates.filter(r => r.end_year === latestYear);
        if (latest.length !== 1) { diagnostics.ambiguousPhd++; continue; }
        phd = latest[0];
      }
      const phdYear = phd.end_year ?? null, undated = phdYear === null;
      if (!Number.isInteger(phdYear) && !(undated && config.years === 'all')) { diagnostics.missingYear++; continue; }
      if (phd.education_review_reason || phd.unresolved_doctoral_institutions?.length) { diagnostics.ambiguousPhd++; continue; }
      const sourcedUndated = undated && config.years === 'all' && !phd.education_review_reason &&
        !phd.unresolved_doctoral_institutions?.length && ['verified', 'uncertain'].includes(phd.verification_status);
      if (!(phd.verification_status === 'verified' || sourcedUndated) || !phd.sources?.some(s =>
          (s.extraction_status === 'verified' || sourcedUndated && s.extraction_status === 'uncertain') && s.source_url && s.source_snapshot?.trim())) {
        diagnostics.unverifiedPhd++; continue;
      }
      if (!undated && (phdYear > endYear || startYear !== null && phdYear < startYear)) { diagnostics.outsideCohort++; continue; }
      const chosen = chooseJob(person, roles, config, diagnostics);
      if (!chosen) continue;
      const destination = universityOf(chosen.job.school_id);
      if (!inDestinationSample(destination)) { diagnostics.outsideDestinationSample++; continue; }
      const destinationInput = chosen.incompleteBest ? null : weight(config.mode, chosen.job.school_id);
      if (undated) diagnostics.undatedIncluded++;
      if (destinationInput === null) diagnostics.missingScore++;
      for (const affiliation of phd.origin_affiliations || [{school_id: phd.school_id, credit_weight: 1}]) {
      const originUnit = schools.get(affiliation.school_id), origin = universityOf(affiliation.school_id);
      const creditWeight = affiliation.credit_weight;
      const contribution = destinationInput === null ? null : destinationInput * creditWeight;
      const graduate = { facultyId: person.faculty_id, name: person.name, phdYear, undated, educationStatus: phd.verification_status, origin, destination,
        originUnit: originUnit.parent_school_id ? originUnit : null,
        title: chosen.job.position_title, startYear: chosen.job.start_year, endYear: chosen.job.end_year,
        contribution, uncappedContribution: contribution, isSelfPlacement: origin.school_id === destination.school_id, selfPlacementFactor: 1, creditWeight, destinationInput, scored: contribution !== null, incompleteBest: chosen.incompleteBest,
        selectedRoleId: chosen.job.role_id, cvUrl: person.cv_url, profileUrl: person.website_url,
        evidence: { phd: evidence(phd.sources), job: evidence(chosen.job.sources), person: evidence(person.sources) }, isSynthetic: false };
      if (!groups.has(origin.school_id)) groups.set(origin.school_id, { school: origin, graduates: [], units: new Map() });
      const group = groups.get(origin.school_id); group.graduates.push(graduate);
      if (originUnit.parent_school_id) {
        if (!group.units.has(originUnit.school_id)) group.units.set(originUnit.school_id, { school: originUnit, graduates: [] });
        group.units.get(originUnit.school_id).graduates.push(graduate);
      }
      }
    }
    for (const group of groups.values()) {
      const selfScore = group.graduates.filter(g => g.isSelfPlacement).reduce((sum, g) => sum + (g.contribution ?? 0), 0);
      const externalScore = group.graduates.filter(g => !g.isSelfPlacement).reduce((sum, g) => sum + (g.contribution ?? 0), 0);
      const factor = selfPlacementRule?.enabled && selfScore > 0
        ? Math.min(1, externalScore * selfPlacementRule.max_self_to_external_score / selfScore) : 1;
      group.selfPlacementFactor = factor;
      for (const unit of group.units.values()) unit.selfPlacementFactor = factor;
      for (const graduate of group.graduates) {
        if (!graduate.isSelfPlacement) continue;
        graduate.selfPlacementFactor = factor;
        if (graduate.contribution !== null) {
          if (factor < 1 && graduate.contribution > 0) diagnostics.selfPlacementsAdjusted++;
          graduate.contribution *= factor;
        }
      }

    }
    function summarize(group) {
      const scored = group.graduates.filter(g => g.scored), sum = scored.reduce((s, g) => s + g.contribution, 0);
      const selfScore = group.graduates.filter(g => g.isSelfPlacement).reduce((total, g) => total + (g.uncappedContribution ?? 0), 0);
      const externalScore = group.graduates.filter(g => !g.isSelfPlacement).reduce((total, g) => total + (g.uncappedContribution ?? 0), 0);
      return { school: group.school, score: sum,
        selfPlacementCap: {external_score: externalScore, self_score: selfScore,
          uncapped_score: externalScore + selfScore, self_score_factor: group.selfPlacementFactor,
          credited_self_score: selfScore * group.selfPlacementFactor,
          cap_applied: selfScore > 0 && group.selfPlacementFactor < 1}, graduateCount: group.graduates.length,
        scoredCount: scored.length, hasScore: scored.length > 0, missingScoreCount: group.graduates.length - scored.length,
        averageWeight: scored.length ? sum / scored.length : null,
        destinationCount: new Set(group.graduates.map(g => g.destination.school_id)).size,
        graduates: [...group.graduates].sort((a, b) => b.phdYear - a.phdYear || a.name.localeCompare(b.name)),
        units: group.units ? [...group.units.values()].map(summarize).sort((a, b) => a.school.name.localeCompare(b.school.name)) : [] };
    }
    const all = [...groups.values()].map(summarize).sort((a, b) => Number(b.hasScore) - Number(a.hasScore) || b.score - a.score || a.school.name.localeCompare(b.school.name));
    const maximum = Math.max(0, ...all.map(r => r.score));
    const subscores = sourceMetrics?.[`${config.mode}|${config.appointment}|${config.years}`] || {};
    function decorate(row) {
      const metrics = subscores[row.school.school_id] || {};
      const sourceStatus = id => storedSourceRanks || minimumCellSize?.enabled
        ? metrics[id]?.status || 'unavailable'
        : metrics[id]?.contributors >= 2 && metrics[id].score != null ? 'published' : 'suppressed';
      return { ...row, displayScore: row.hasScore ? row.score : null,
        rank: null, globalRank: null,
        sourceRanks: storedSourceRanks ? Object.fromEntries(sourceColumns
          .filter(s => sourceStatus(s.id) === 'published' && metrics[s.id]?.rank != null)
          .map(s => [s.id, metrics[s.id].rank])) : {},
        ...(storedSourceRanks ? {} : {sourceScores: Object.fromEntries(sourceColumns.map(s =>
          [s.id, sourceStatus(s.id) === 'published' ? metrics[s.id].score : null]))}),
        sourceContributorCounts: Object.fromEntries(sourceColumns.map(s => [s.id, metrics[s.id]?.contributors || 0])),
        sourceStatuses: Object.fromEntries(sourceColumns.map(s => [s.id, sourceStatus(s.id)])),
        sourceMissingCounts: Object.fromEntries(sourceColumns.map(s => [s.id, metrics[s.id]?.missing ?? row.graduateCount])),
        units: row.units.map(decorate) };
    }
    function assignRanks(rows, field) {
      let previous = null, rank = null;
      return rows.map((r, index) => {
        if (r.hasScore && (previous === null || Math.abs(r.score - previous) > 1e-12)) rank = index + 1;
        if (r.hasScore) previous = r.score;
        return { ...r, [field]: r.hasScore ? rank : null };
      });
    }
    const global = assignRanks(all.map(decorate), 'globalRank');
    const rows = assignRanks(global.filter(r => inRegion(r.school, config.universe)), 'rank');
    for (const source of sourceColumns) {
      const sourceValue = row => storedSourceRanks ? row.sourceRanks[source.id] : row.sourceScores[source.id];
      const ordered = rows.filter(r => sourceValue(r) != null)
        .sort((a, b) => (storedSourceRanks ? sourceValue(a) - sourceValue(b) : sourceValue(b) - sourceValue(a)) ||
          a.school.name.localeCompare(b.school.name));
      // Capture stored ranks before replacing them with ranks in this region.
      const values = ordered.map(sourceValue);
      let previous = null, rank = null;
      ordered.forEach((row, i) => {
        const value = values[i];
        if (previous === null || Math.abs(value - previous) > 1e-12) rank = i + 1;
        row.sourceRanks[source.id] = rank; previous = value;
      });
    }
    const graduates = [...new Map(rows.flatMap(r => r.graduates).map(g => [g.facultyId, g])).values()];
    return copy({ config, meta: data.meta, mode: modes.find(m => m.id === config.mode),
      ...(config.mode === recursiveMode ? {recursive: recursiveInfo} : {}),
      cohort: { years: config.years, startYear, endYear }, rows, globalProgramCount: all.length, globalMaxScore: maximum,
      totals: { programCount: rows.length, graduateCount: graduates.length, scoredGraduateCount: graduates.filter(g => g.scored).length,
        destinationCount: new Set(graduates.map(g => g.destination.school_id)).size,
        destinationCountryCount: new Set(graduates.map(g => g.destination.country_code).filter(Boolean)).size,
        missingScoreCount: graduates.filter(g => !g.scored).length }, diagnostics });
  }

  async function getDataOverview(request = {}) {
    const mode = request.mode || options.defaults.mode;
    if (!inputs.has(mode)) throw new Error('Unknown scoring input.');
    if (mode === recursiveMode) await prepareRecursiveWeights();
    const byName = new Map(data.schools.filter(s => !s.parent_school_id).map(s => [(s.scoring_name || s.name).trim(), s]));
    const block = mode === recursiveMode
      ? {scores: [...inputs.get(mode)].map(([school_name, score]) => ({school_name, score, source_count: null}))}
      : data.destination_inputs.find(b => b.ranking_type === mode);
    const sourceTotal = block.component_count ?? (data.ranking_metadata.sources.length + (data.program_ranking_metadata?.recursive_subscore ? 1 : 0));
    // Count observed finance appointment records at the destination university,
    // including faculty whose PhD records have not yet been enriched.
    const appointments = new Map();
    const appointmentSources = new Map();
    const addSources = (id, sources) => {
      if (!appointmentSources.has(id)) appointmentSources.set(id, new Map());
      for (const source of sources || []) {
        const key = source.source_url || `${source.source_document || ''}|${source.source_sheet || ''}`;
        if (key !== '|') appointmentSources.get(id).set(key, source);
      }
    };
    for (const school of data.schools) addSources(universityOf(school.school_id).school_id, school.faculty_list_sources);
    for (const role of data.faculty_roles) {
      if (role.role_type !== 'job' || people.get(role.faculty_id).field !== 'finance' ||
          role.start_year > data.meta.as_of_year) continue;
      const id = universityOf(role.school_id).school_id;
      appointments.set(id, (appointments.get(id) || 0) + 1);
      addSources(id, role.sources);
    }
    const entries = block.scores.filter(r => !destinationSample || destinationSample.has(r.school_name.trim())).map(r => ({ school: byName.get(r.school_name.trim()) || { name: r.school_name },
      input: r.score, sourceCount: r.source_count, missingSourceCount: r.source_count == null ? null : sourceTotal - r.source_count,
      facultyCount: r.faculty_count ?? null, facultySizeFactor: r.faculty_size_factor ?? 1,
      unadjustedMetaScore: r.score_before_faculty_size_adjustment ?? r.score,
      metaNormalizationDivisor: block.normalization_after_faculty_size?.divisor ?? 1, rank: null }));
    const supplied = new Set(block.scores.map(r => r.school_name.trim()));
    for (const [name, school] of byName) {
      if (!supplied.has(name) && inDestinationSample(school)) entries.push({ school, input: null, sourceCount: 0, missingSourceCount: sourceTotal, rank: null });
    }
    const metaRanking = entries.filter(r => r.input == null || zeroAnchorRank != null || r.input >= 0)
      .map(r => ({ ...r, metaScore: inputs.get(mode).get((r.school.scoring_name || r.school.name).trim()) ?? null,
        appointmentCount: appointments.get(r.school.school_id) || 0,
        appointmentSources: evidence([...(appointmentSources.get(r.school.school_id)?.values() || [])]),
        hasPlacementData: (appointments.get(r.school.school_id) || 0) > 0 }))
      .sort((a, b) => a.input == null || b.input == null ? a.input === b.input ? a.school.name.localeCompare(b.school.name) : a.input == null ? 1 : -1 : b.input - a.input || a.school.name.localeCompare(b.school.name));
    let previous = null, rank = null;
    metaRanking.forEach((r, i) => { if (r.input !== null) { if (previous === null || Math.abs(r.input - previous) > 1e-12) rank = i + 1; r.rank = rank; previous = r.input; } });
    const phds = data.faculty_roles.filter(r => r.role_type === 'phd'), years = phds.map(r => r.end_year).filter(Number.isInteger);
    const currentFinanceCounts=countCurrentFinanceFaculty(data);
    return copy({ meta: data.meta, metaRanking, mode: modes.find(m => m.id === mode),
      selfPlacementSummary: data.self_placement_summary || null,
      ...(mode === recursiveMode ? {recursive: recursiveInfo} : {}), inventory: {
      facultyCount: data.faculty.length, phdRecordCount: phds.length, appointmentRecordCount: data.faculty_roles.filter(r => r.role_type === 'job').length,
      financeFacultyCount:data.faculty.filter(p=>p.field==='finance').length,
      employingUniversityCount:Object.keys(currentFinanceCounts).length,
      universityCount: data.schools.filter(s => !s.parent_school_id).length, academicUnitCount: data.schools.filter(s => s.parent_school_id).length,
      earliestPhdYear: years.length ? Math.min(...years) : null, latestPhdYear: years.length ? Math.max(...years) : null } });
  }
  return { getOptions: async () => copy(options), getRankings, getDataOverview, getSelfPlacementOverview, getPublicData: async () => copy(data) };
}
