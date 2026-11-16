/* Public deployment settings. This file must never contain credentials or requests. */
(function () {
  'use strict';
  window.PHD_SITE_CONFIG = Object.freeze({
    projectName: "Finance PhD programs ranked by graduates' jobs (2026)",
    defaultExpandedSubunitSchools: Object.freeze([
      'harvard_university', 'massachusetts_institute_of_technology',
      'university_of_chicago', 'stanford_university'
    ]),
    alwaysShownRankingSubunits: Object.freeze(['university_of_chicago__department_of_economics']),
    hiddenRankingSubunits: Object.freeze(['harvard_business_school']),
    privacyContactEmail: 'will.gornall@sauder.ubc.ca'
  });
})();
