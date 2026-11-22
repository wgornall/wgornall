window.createAppMiddleware = async function () {
  const getJSON = async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Unable to load ${path.split('?')[0]} (HTTP ${response.status}).`);
    return response.json();
  };
  const [{createMiddleware}, inputs] = await Promise.all([
    import('./placement-middleware.mjs?v=00230a393db74d5c'), getJSON('./placement-ranking-inputs.json?v=b018627f23ffadd9')
  ]);
  const ranking = createMiddleware(inputs);
  let details, publications;
  return {
    getOptions: ranking.getOptions,
    getRankings: ranking.getRankings,
    async getGraduateEvidence(config, destinationWeights, schoolId, facultyId) {
      details ??= getJSON('./placement-data.json?v=9153ade79eb9a57a').then(createMiddleware).catch(error => {
        details = null;
        throw error;
      });
      const {rows} = await (await details).getRankings(config,{destinationWeights});
      for (const row of rows) {
        const school = [row, ...row.units].find(item => item.school.school_id === schoolId);
        if (school) return school.graduates.find(graduate => graduate.facultyId === facultyId);
      }
    },
    getPublicationEvidence() {
      publications ??= getJSON('./publication-evidence.json?v=30b3c9832d1f8f10').catch(error => {
        publications = null;
        throw error;
      });
      return publications;
    }
  };
};
