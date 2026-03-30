"use strict";

const {
  rankJobsForProfile,
  MOCK_JOBS,
  MOCK_PROFILE,
} = require("../services/jobProfileMatcher");

const results = rankJobsForProfile(MOCK_PROFILE, MOCK_JOBS);

console.log("\n══════════════════════════════════════════════════");
console.log("  TEST — Job Profile Matcher");
console.log("  Perfil: IC + Magíster Finanzas + práctica + Excel/SAP + inglés B1");
console.log("══════════════════════════════════════════════════\n");

results.forEach((job, i) => {
  const icon = {
    high_fit:  "🟢",
    good_fit:  "🟡",
    adaptable: "🟠",
    low_fit:   "🔴",
  }[job.adaptability] || "⚪";

  console.log(`${i + 1}. ${icon} [${job.adaptability.toUpperCase()}] ${job.title} — ${job.company}`);
  console.log(`   Score total: ${job.total_score}/100`);
  console.log(`   Label:       ${job.adaptability_label}`);

  const bd = job.breakdown;
  console.log(`   Breakdown:   educación ${bd.education.score}/${bd.education.max} (${bd.education.status}) | ` +
              `exp ${bd.experience.score}/${bd.experience.max} (${bd.experience.status}) | ` +
              `skills ${bd.skills.score}/${bd.skills.max} (${bd.skills.status}) | ` +
              `idioma ${bd.languages.score}/${bd.languages.max} (${bd.languages.status}) | ` +
              `contexto ${bd.context.score}/${bd.context.max} | ` +
              `seniority ${bd.seniority.score}/${bd.seniority.max}`);

  if (job.hard_filter_failures.length) {
    console.log(`   ⚠ Hard filters: ${job.hard_filter_failures.map(f => `${f.dimension}(${f.reason})`).join(", ")}`);
  }
  if (job.missing_signals.length) {
    console.log(`   Brechas:     ${job.missing_signals.join(" | ")}`);
  }
  console.log(`   Siguiente:   ${job.next_step_hint}`);
  console.log();
});
