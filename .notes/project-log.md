# Labora MVP — Notas del proyecto

Directorio de notas técnicas. Actualizar tras cada sesión significativa.
Vinculado desde `CLAUDE.md` en la raíz del proyecto.

---

## Sesión 2026-03-27 — jobProfileMatcher.js (segunda capa)

### Cambios implementados

**Módulo nuevo:** `server/services/jobProfileMatcher.js`
- `normalizeJobPosting(raw)` — limpia oferta, infiere modality y seniority si faltan
- `scoreJobFit(profile, job)` — 6 dimensiones (educación 25, exp 20, skills 25, idioma 15, contexto 10, seniority 5)
- `classifyJobAdaptability(scoreResult)` — 4 niveles: high_fit/good_fit/adaptable/low_fit
- `rankJobsForProfile(profile, rawJobs)` — pipeline completo: normaliza → scorea → clasifica → ordena
- `MOCK_JOBS` — 5 ofertas mock realistas (Chile)
- `MOCK_PROFILE` — IC + Magíster Finanzas + práctica + Excel/SAP + inglés B1

**Script de test:** `server/scripts/testJobMatcher.js`
- Corre con: `node server/scripts/testJobMatcher.js`

**Resultados del test (perfil IC+finanzas):**
| Oferta | Score | Adaptabilidad |
|---|---|---|
| Analista Financiero Jr — BCI | 90 | high_fit |
| Analista Comercial Jr — Entel | 87 | high_fit |
| Analista Control Gestión Jr — Falabella | 75 | high_fit |
| Analista de Datos Jr — Cornershop | 52 | good_fit |
| Senior FP&A — Pelambres | 16 | low_fit |

**Mapeo perfil Labora → jobProfileMatcher:**
- `profile.degree` → educación
- `profile.profile_quality.experience_level` → experiencia
- `profile.tools + profile.skills` → skills
- `profile.languages + profile.language_levels` → idioma (language_levels es campo extendido opcional)
- `profile.city + profile.desired_modality` → contexto
- `profile.profile_quality.experience_level` → seniority (low/medium → junior, high → semi-senior)

**Hard filters distintos de preferred signals:**
- Estructurales: seniority_gap≥2, experience_gap>1yr, required_degree_mismatch
- Idioma: level_gap≥2, no_[language]
- Penalty: ×0.72^n por cada hard filter

**Integración futura:**
- Punto de entrada: POST /api/jobs/match (ruta nueva, no toca /api/analyze)
- Fuente de datos: scraper/API → `rankJobsForProfile(profile, jobs)`
- Frontend: bloque debajo de resultados de roles existentes

---

## Sesión 2026-03-27 — Refactorización completa (Fases 1–9) + job links

### Cambios implementados

**Fase 1 — buildMissingSkills**
- Usa `role.required_skills` (subset estricto), no `role.skills` completo.
- `top_missing_skills`: máx 3, accionables primero (`ACTIONABLE_SKILLS` Set).

**Fase 2 — Scoring dinámico**
- `evaluateProfileQuality` → `{experience_level, skill_level, specialization_clarity}`.
- `getDynamicWeights` → pesos ajustados según calidad. `WEIGHTS_BY_PROFILE`: weak/medium/strong.
- Normalización: `(raw/max) × peso / totalWeightSum × 100`. Garantiza escala 0-100 consistente.
- ⚠️ La normalización comprime scores: perfil thin (solo grado+interés) llega a máx ~39. Ver bug #1.

**Fase 3 — Penalización ×0.6**
- `scoreDegree === 0` → score × 0.6, no exclusión total.

**Fase 4 — classifyUserType**
- `"explore" | "misaligned" | "aligned"`. Evidencia = skills + exp + spec (sin degree).
- Excluir degree del evidenceScore: Ing. Comercial matchea finanzas Y comercial por igual → no discrimina.

**Fase 5 — evaluateInterestAlignment**
- Por rol: `{alignment: "high"|"medium"|"low", declared_interest: bool}`.
- `interest_note` generado solo si alignment=low AND declared_interest=true.
- También excluye degree del evidenceScore (misma razón que Fase 4).

**Fase 6 — computeRecommendationScore**
- `is_recommended` se asigna por max recommendation_score, no por max score bruto.
- Fórmula: score - missingCount×3 + alignBonus + noGapsBonus + specBonus.

**Fase 7 — buildGaps accionable**
- `SKILL_GAP_PHRASES[4]` rotando. Sin frases tipo "No aparece evidencia de X".

**Fase 8 — buildContextMessage + contextBanner**
- `context_message: {headline, subtext}` adaptado a user_type.
- Frontend: `contextBanner` renderizado antes del `recommendedBanner`.

**Fase 9 — CV opcional**
- `analyze.js`: `req.file` null → perfil mínimo con metadata del formulario.
- `upload.html`: CV sin `required`, hints actualizados, preferences ocultas.
- `app.js`: removed `throw` en submit sin CV.

**Módulo job links**
- `generateJobLinks(role, location)` → URLs LinkedIn, Indeed, Laborum + GetOnBoard condicional.
- `GETONBOARD_CATEGORIES = Set(["analitica", "tecnologia"])`.
- Frontend: botones `.role-job-links` en cada tarjeta.

---

### Bugs encontrados y corregidos

**Bug #1 — STRETCH_THRESHOLD demasiado alto**
- Síntoma: perfil IC + finanzas (sin CV) → 0 resultados.
- Causa: normalización Fase 2 → max score sin skills/exp = 39. Umbral era 40.
- Fix: `STRETCH_THRESHOLD = 35`.
- Archivo: `server/services/roleMatcher.js`.

**Bug #2 — parsedText no definida sin CV**
- Síntoma: `ReferenceError: parsedText is not defined` al enviar sin CV.
- Causa: `cvTextPreview: parsedText.slice(0, 500)` en el return, pero `parsedText` solo se asignaba dentro de `if (req.file)`.
- Fix: `let parsedText = ""` antes del if + `parsedText = cvText` dentro del if.
- Archivo: `server/routes/analyze.js`.

**Bug #3 — evidenceScore incluía degreeScore**
- Síntoma: `classifyUserType` y `evaluateInterestAlignment` marcaban como "aligned" cuando solo había grado, no skills.
- Causa: Ing. Comercial tiene degree=30 para finanzas Y comercial → inflaba evidencia artificialmente.
- Fix: evidenceScore = skillScore + expScore + specScore (sin degreeScore).

**Bug #4 — MISALIGNED detectado como EXPLORE**
- Síntoma: usuario con interés declarado en finanzas → user_type "explore".
- Causa: GENERIC_INTERESTS filtering eliminaba "finanzas" y "analitica" de la cuenta de intereses específicos.
- Fix: eliminado el filtrado por GENERIC_INTERESTS en classifyUserType. Explore = sin intereses OR sin resultados.

---

### Pendientes

- [ ] CSS específico para `.context-banner` y `.context-headline`
- [ ] `noResultsMsg` condicional por `user_type`
- [ ] Eliminar `console.log` de debug en `renderInterestsForCareer` y `getCareerSpecificInterests`
- [ ] Ampliar catálogo: actualmente 11 roles, ideal ~20-25
- [ ] Usar campo `region` en matching
- [ ] Usar `preferences` en ranking
- [ ] classifyUserType en roleMatcher.js: retornar `{ visible_mode, internal_alignment }` (plan pendiente)
- [ ] Ampliar catálogo: actualmente 11 roles, ideal ~20-25
- [ ] CSS `.context-banner` / `.context-headline`

---

## Sesión 2026-03-27 — Mejora UX tarjetas de rol

### Cambios

**roleMatcher.js — SKILL_GAP_PHRASES reescritas:**
- Antes: "Sería útil sumar experiencia o manejo en flujo de caja"
- Después: "Sumar práctica en flujo de caja fortalecería tu candidatura."
- Tono orientado a acción y progreso. 4 frases rotativas.
- Frase de experiencia faltante también reescrita.

**app.js — renderRoleCard mejorado:**
1. `scoreInterpretation(score)` — texto humano bajo el badge (≥70: buena base / ≥50: bien encaminado / <50: potencial)
2. "Brechas detectadas" → "Qué puedes mejorar" (cambio de encabezado)
3. Links a ofertas: encabezado "Ver ofertas relacionadas:" + botones en `.role-job-links-row`
4. Bloque "Siguiente paso recomendado" con texto contextual antes del CTA
5. `cvBuilderLabel(title, hasCv)` — CTA con nombre del rol ("Crear CV para Analista Financiero Junior"), fallback si >44 chars

**styles.css:**
- `.score-interpretation` (3 variantes de color según score)
- `.role-job-links-label` + `.role-job-links-row`
- `.role-next-step` + `.role-next-step-title` + `.role-next-step-text`

---

## Sesión 2026-03-27 — Integración CV Builder cerrada

### Cambios implementados

**app.js:**
- `currentHasCv = (profile.raw_text_length || 0) > 0` — se setea en `renderResults()`
- `renderRoleCard()` agrega bloque `.role-cv-builder-action` con botón adaptativo:
  - Sin CV → `"Crear CV para este rol"` → `/cv-builder.html?mode=generate&role=ROL`
  - Con CV  → `"Optimizar mi CV para este rol"` → `/cv-builder.html?mode=optimize&role=ROL`

**cv-builder.html** — reescrita para modo dual:
- `mode=generate`: mini flujo 4 bloques con pre-fill desde sessionStorage; campo LinkedIn agregado; microcopy mejorado en "¿Qué hiciste?"
- `mode=optimize`: panel de confirmación con resumen del perfil → CTA → llama API → muestra resultado
- Resultado compartido: badge versión, resumen, experiencias+bullets, herramientas, idiomas, mejoras, gaps, nota footer

**styles.css:** `.role-cv-builder-action` — botón full-width separado por borde en cada tarjeta de rol

### Flujo de navegación final

```
results.html
  ↳ [Con CV]  "Optimizar mi CV para X" → /cv-builder.html?mode=optimize&role=X
                → panel confirma perfil → clic → POST /api/cv/build flow=optimize → resultado
  ↳ [Sin CV]  "Crear CV para X" → /cv-builder.html?mode=generate&role=X
                → formulario 4 bloques → POST /api/cv/build flow=generate → resultado
```

---

## Sesión 2026-03-27 — Cierre de integración CV Builder

### Cambios implementados

**analyze.js:** agrega `cvRawText: parsedText || null` al response. Sin CV → null.
**app.js:** guarda `sessionStorage.setItem("laboraCvRawText", data.cvRawText || "")` separado de laboraResults.
**cv-builder.html (nueva):** mini flujo Caso B — 4 bloques, auto-prellenado desde sessionStorage:
  - Bloque 1: Formación (universidad, carrera, etapa, año)
  - Bloque 2: Experiencias (hasta 3, con what_did → bullets)
  - Bloque 3: Herramientas e idiomas (tags input, pre-filled desde profile)
  - Bloque 4: Contacto opcional (nombre, email)
  - On submit → POST /api/cv/build flow=generate → renderiza resultado inline
  - URL: /cv-builder.html?role=NOMBRE_ROL

**academic_status:** contrato documentado y confirmado OK:
  - HTML → req.body: `academicStatus` (camelCase)
  - profile / userInputs: `academic_status` (snake_case)
  - Conversión en analyze.js:88. Consistente en todo el pipeline.

### Contrato POST /api/cv/build (final)

**flow=optimize** (con CV):
```json
{ "flow": "optimize", "targetRole": "...", "profile": {...}, "rawCvText": "..." }
```
rawCvText: desde sessionStorage.getItem("laboraCvRawText") || ""

**flow=generate** (sin CV, desde cv-builder.html):
```json
{ "flow": "generate", "targetRole": "...", "userInputs": { "degree": "...", "academic_status": "...", "institution": "...", "graduation_year": "...", "tools": [...], "languages": [...], "experiences": [{...}] } }
```

**Output:**
```json
{ "success": true, "flow": "...", "cv_version_type": "optimized|generated", "target_role": "...", "cv": {...}, "improvements_made": [...], "missing_information": [...], "sections": {...} }
```

### Estado de readiness para botones finales

| Botón | Ready? | Requisito faltante |
|---|---|---|
| "Crear CV para este rol" | ✅ SÍ | href="/cv-builder.html?role=ROL" |
| "Optimizar mi CV para este rol" | ⚠️ Casi | Añadir el botón + lógica en results.html |

---

## Sesión 2026-03-27 — CV Builder completo (Módulos + Ruta + Tests)

### Cambios implementados

**Módulos nuevos:**
- `server/services/cvStructure.js` — esquema estándar, verbos por área, señales de relevancia, mapeo rol→área
- `server/services/cvNormalizer.js` — perfil aiExtractor + texto crudo → estructura estándar
- `server/services/cvOptimizer.js` — heurístico: resumen, bullets, priorización + prompts LLM listos
- `server/services/cvDraftGenerator.js` — genera CV desde inputs simples (sin archivo)
- `server/routes/cv.js` — POST /api/cv/build (flow: optimize | generate)
- `server/scripts/testCVBuilder.js` — test de ambos flujos: node server/scripts/testCVBuilder.js

**Wiring:** `server/server.js` — agregado `app.use("/api/cv", cvRouter)`

**Bugs corregidos durante test:**
- `parseBulletsFromBlock`: solo toma líneas con marcador bullet (`[-•·*►]`); evita incluir org/rol como bullet
- `parseEducationSection`: `!inSection` guard evita que "Universidad de Chile" active el pattern de sección
- `cleanBullet`: strip de verbos en primera persona pasado (-é, -í) antes de detectar si ya tiene verbo de acción
- `startsWithActionVerb`: usa set global de todos los verbos (todas las áreas) en vez de solo el área objetivo

**Arquitectura LLM-ready:**
- `cvOptimizer.js` exporta `buildOptimizePrompt(cv, profile, targetRole)` y `buildGeneratePrompt(userInputs, targetRole)`
- Comentarios `// FUTURE: LLM` marcan los puntos exactos de integración
- Requiere instalar: `npm install @anthropic-ai/sdk`

**Flujos:**
- Caso A (con CV): `normalizeCV(profile, rawText)` → `optimizeCV(normalizedCV, profile, targetRole)` → `{ cv, improvements_made, missing_information }`
- Caso B (sin CV): `generateCVDraft(userInputs, targetRole)` → mismo output

**Ejemplo de llamada HTTP (flow generate):**
```bash
curl -X POST http://localhost:3000/api/cv/build \
  -H "Content-Type: application/json" \
  -d '{"flow":"generate","targetRole":"Analista de Datos Junior","userInputs":{...}}'
```
