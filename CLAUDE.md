# CLAUDE.md — Labora MVP

Reglas operativas para este proyecto. Actualizar tras cada corrección o sesión significativa.
Notas detalladas del proyecto: `.notes/project-log.md`

---

## Contexto del proyecto

Motor de matching laboral para egresados chilenos. Stack: Node.js + Express + multer + vanilla JS frontend.
Servidor activo en PM2, puerto 3000. Comando: `pm2 restart labora-mvp`.

Archivos clave:
- `server/services/roleMatcher.js` — motor de scoring; modo explore: latent profile first (cv+behavioral-avoid, sin areaBoost); modo guided: 6 dimensiones + pesos dinámicos
- `server/routes/analyze.js` — POST /api/analyze, recibe CV + metadatos del formulario (incluyendo task_preferences y motivation_preferences)
- `server/services/aiExtractor.js` — extrae perfil estructurado del texto del CV
- `data/junior_roles.json` — catálogo de 44 roles junior con required_skills, families, traits (8 dimensiones conductuales), entry_type, has_commission, requires_cv_gate
- `public/app.js` — lógica frontend + renderizado de resultados
- `public/upload.html` — formulario de onboarding
- `server/utils/text.js` — `normalizeText`, `arrayIncludesNormalized`, `overlapCount`

---

## Reglas de flujo de trabajo

### Planificación
- Entrar en modo plan para cualquier tarea de 3+ pasos o con decisiones de arquitectura.
- Escribir la especificación antes de tocar código.
- Si algo se desvía, detenerse y replantear antes de continuar.

### Verificación
- Nunca declarar una tarea completa sin evidencia: correr el servidor, hacer una llamada real, revisar logs.
- Ante cualquier cambio en `roleMatcher.js` o `analyze.js`: reiniciar PM2 y hacer un request de prueba.
- Revisar `pm2 logs labora-mvp` ante errores inesperados.

### Subagentes
- Exploración de código → agente Explore.
- Investigación / análisis paralelo → agente general-purpose.
- No hacer búsquedas amplias en el hilo principal.

### Corrección de errores
- Ante un reporte de error: leer logs → identificar causa raíz → corregir → verificar. Sin preguntar.
- Actualizar este CLAUDE.md y `.notes/project-log.md` después de cada corrección.

---

## Reglas técnicas — lecciones aprendidas

### 1. No asumir que `parsedText` está definida en el scope completo
**Error:** `ReferenceError: parsedText is not defined` en el return de `analyze.js` cuando no hay CV.
**Regla:** Si una variable se usa en el `return` final, inicializarla antes de cualquier bloque `if`.
```js
let parsedText = "";          // ← fuera del if
if (req.file) {
  const { text: cvText } = await parseUploadedFile(...);
  parsedText = cvText;        // ← asignar dentro del if
}
return res.json({ cvTextPreview: parsedText.slice(0, 500), ... });
```

### 2. La normalización de pesos cambia la escala efectiva de los scores
**Error:** Bajar `STRETCH_THRESHOLD` a 40 tras Fase 2 produjo 0 resultados para perfiles thin.
**Causa:** Con normalización `(raw/max × peso) / totalWeightSum × 100`, el máximo alcanzable con solo grado+interés es ~39, no 40.
**Regla:** Al cambiar la fórmula de scoring, recalcular los umbrales. Perfil thin (grado exacto + interés prioridad 1) debe llegar al STRETCH_THRESHOLD.
**Umbral actual:** `STRETCH_THRESHOLD = 25`, `STRONG_THRESHOLD = 65`.
_(Bajado de 35 → 25 para permitir que carreras de salud y carreras desconocidas muestren resultados cuando declaran interés. Perfiles thin con solo grado secondary + interés alcanzan ~22-28; la penalización ×0.6 para combos completamente no relacionados los baja a ~7.)_

### 3. No incluir degreeScore en evidenceScore
**Error:** `classifyUserType` y `evaluateInterestAlignment` inflaban la evidencia contando el grado.
**Causa:** Ing. Comercial tiene degree=30 para finanzas Y comercial → no discrimina qué área conoce el usuario.
**Regla:** `evidenceScore = skillScore + expScore + specScore`. El grado es contexto formativo, no evidencia de especialización.

### 4. GENERIC_INTERESTS no debe filtrar en classifyUserType
**Error:** Usuarios con interés declarado en "finanzas" o "analitica" eran clasificados como "explore".
**Causa:** `GENERIC_INTERESTS` eliminaba esos valores, dejando sin intereses específicos.
**Regla:** EXPLORE = `interests.length === 0 OR allMatches.length === 0`. No filtrar por genericidad.

### 5. Encoding UTF-8 en tests con curl en Windows/bash
**Nota:** `curl -F "degree=Ingeniería Comercial"` corrompe caracteres especiales en bash de Windows.
El servidor recibe "Ingenier\ufffd\ufffda Comercial" → `normalizeText` no puede hacer match.
**Regla:** Siempre testear desde el browser real o usar `-H "Content-Type: application/json"` con `-d` y escape Unicode (`\u00ed`) para tests con curl.

### 6. has_postgrad: dos fuentes, una respuesta
**Regla:** `has_postgrad` se fusiona con OR: `extractedProfile.has_postgrad || formPostgrad`.
- Sin CV: viene 100% del formulario (`hasPostgrad: "true"` en el body).
- Con CV: cualquiera de las dos fuentes lo activa.
La pregunta del formulario solo aparece cuando `academicStatus === "titulado"`.

### 7. academicStatus es hidden input, no select
**Error:** `renderSummary` usaba `.options[selectedIndex].text` para leer el valor → devolvía "—" siempre.
**Causa:** Se reemplazó el `<select>` por tarjetas + `<input type="hidden" id="academicStatus">`.
**Regla:** Leer `.value` directamente y mapear con `STATUS_LABELS = { estudiante, egresado, titulado }`.

### 8. Variables `let` en express handlers: scope dentro de try
**Regla general:** Declarar con `let` fuera de cualquier `if`/bloque todas las variables que se usen en el `return` del handler. No asumir que el scope de `const` dentro de un `if` es visible afuera.

---

## Principios de diseño del motor (no cambiar sin razón)

- **Degree score ≠ evidencia de especialización.** El grado abre la puerta; skills/exp/spec la acreditan.
- **Normalización por totalWeightSum.** Garantiza escala 0-100 independiente de la configuración de pesos.
- **Penalización ×0.6 en vez de exclusión.** Sin overlap formativo → score reducido, no descartado.
- **required_skills vs skills.** `required_skills` = las indispensables (subset). `skills` = todas las deseables. `buildMissingSkills` usa solo `required_skills`.
- **GetOnBoard solo para analitica/tecnologia.** La plataforma es de tech; aplicar a otros roles genera ruido.

---

## Estado actual (2026-04-04)

### Completado en iteraciones anteriores (hasta 2026-04-01)
- Catálogo expandido de 11 → 24 roles con required_skills calibrados
- Motor de scoring 6 dimensiones, umbrales Strong ≥65 / Stretch 25-64
- Pregunta condicional postgrado + isLastYear
- has_postgrad fusionado (formulario + CV)
- Etapa académica: tarjetas visuales
- Deploy en Render.com completado

### Completado en esta iteración (2026-04-04)

**Simplificación a Ingeniería Comercial:**
- CAREER_FAMILIES: 85 carreras → solo "ingenieria comercial"
- CAREER_CATEGORIES y CAREER_ALIASES: eliminadas todas las demás carreras
- junior_roles.json: related_degrees → ["Ingeniería Comercial"] en los 24 roles
- upload.html step-1: campo estático (no autocomplete), hidden input

**Sprint UX — humanización de copy y tono:**
- Pantalla inicial: título, subtítulo, cards y CTA reescritos
- Flujo guided: subtítulos más humanos en todos los pasos
- Flujo explore: copy nuevo en tareas, evitar, motivación y confirmación
- Resumen: "Antes de ver tus opciones" + CTA "Ver mis opciones →"
- Resultados: perfil → "Lo que se alcanza a ver...", área → lenguaje humano
- Cards de rol: secciones renombradas, fitLevel más humano
- buildNextStep: próximos pasos accionables y específicos por área (finanzas, analítica, comercial, operaciones, personas, marketing)
- buildProfileHook: frases conectadas al área que eligió el usuario
- buildRoleAlignment: interés principal con framing más directo
- Jerarquía: rol principal con contexto + "También aparecen caminos cercanos"
- ROLE_AREA_EXPECTATIONS: reescritas en lenguaje concreto y específico

**Sprint UX — pantalla explore-confirm:**
- Título: "Esto es lo que más hace sentido con lo que nos contaste"
- buildConfirmExplanation: clasificación por perfil (analitico / relacional / operativo / estrategico / mixto)
- Texto interpretativo: lenguaje natural, sin enumerar inputs
- Contraste "más que…" opcional — solo cuando hay señal de avoid relevante
- Header "Tienes más afinidad hoy con:" antes de las cards
- Instrucción "Elige 1 o 2 caminos que sientas más cercanos a ti ahora."
- CTA: "Quiero ver cómo seguir desde aquí →"
- AREA_DESCRIPTIONS: en lenguaje claro y cotidiano

### Reglas de copy (no violar)
- No usar: "como elegiste", "según tus respuestas", enumeraciones de inputs
- No usar: expresiones forzadas que no dirías en conversación real
- No usar: señales que el usuario NO dio (ej: mencionar "terreno" si no lo seleccionó)
- Sí usar: "parece que te acomoda", "se ve que te motiva", "probablemente te sientas"
- Contraste "más que..." solo cuando hay avoid claro Y real (señal explícitamente seleccionada)
- Cada rol debe sonar distinto — no variaciones del mismo template

### Regla 9. isLastYear en analyze.js
**Regla:** Leer `req.body.isLastYear` antes de construir el extractedProfile. Si `academicStatus === "estudiante" && isLastYear === "true"`, sobrescribir `metadata.academicStatus = "egresado"` antes de pasar al matcher.

### Regla 10. No fabricar señales de avoid en copy
**Error:** `buildExploreResultsHook()` incluye "terreno" en el texto aunque el usuario no haya seleccionado "trabajo-terreno". El contraste "más que X" solo puede usar valores que están en el array de avoid del usuario. Verificar antes de escribir texto hardcodeado que asuma selecciones.

### Dead data conocido
- `extra_motivation_text` ignorado en scoring.

---

## Estado actual (2026-04-04) — post sprint flujo explorar

### Completado en iteraciones anteriores (hasta 2026-04-03)
- Catálogo expandido de 11 → 24 roles con required_skills calibrados
- Motor de scoring 6 dimensiones, umbrales Strong ≥65 / Stretch 25-64
- Pregunta condicional postgrado + isLastYear
- has_postgrad fusionado (formulario + CV)
- Etapa académica: tarjetas visuales
- Deploy en Render.com completado
- Simplificación a Ingeniería Comercial (step-1 estático, 24 roles con related_degrees)
- Sprint UX humanización: copy guided + explore-confirm

### Completado — Sprint flujo explorar (2026-04-04, commit 4288449)

**Nueva pantalla step-explore-areas:**
- Dos grids: "Me interesa explorar" / "Prefiero evitar por ahora (opcional)"
- 8 áreas: Finanzas, Analítica y datos, Control de Gestión, Comercial y ventas, Marketing, Operaciones, Personas/RRHH, Proyectos
- Previene contradicciones (misma área no puede estar en ambos grids)
- Señal integrada en `inferAreas()`: +4 por interés, -3 por descarte

**Validaciones obligatorias:**
- step-explore-areas: mín 1 interés
- step-explore-1 (tareas): mín 1
- step-explore-2 (evitar): mín 1 (nuevo — antes permitía avanzar vacío)
- step-explore-3 (motivación): mín 1 (nuevo)
- step-explore-confirm: mín 1 (reforzado con hint visible)

**Cambios de flujo:**
- `EXPLORE_STEP_IDS = ["step-explore-areas", "step-explore-1", "step-explore-2", "step-explore-3", "step-explore-confirm"]`
- Step-6 (resumen) eliminado del flujo explore: `next-5` hace `form.requestSubmit()` directo
- `updateProgress()` exploreMap actualizado: `{ 1:1, 2:2, 4:8, 5:9 }` (9 pasos totales)
- EXPLORE_AVOID aplanado a 5 opciones flat (eliminado "industrias-no-van")

**Mejoras de copy:**
- Todos los títulos/subtítulos de pantallas explore reescritos
- Step 4 CV: más persuasivo ("Si tienes tu CV a mano...")
- Step 5 Ciudad: modalidades con descripción ("Presencial (en oficina)")
- `buildConfirmExplanation()`: incorpora motivaciones + áreas explícitas

**Resultados diferenciados:**
- `renderResults()` bifurcado por `sessionStorage.getItem("laboraUserIntentMode")`
- Explore: `buildExploreResultsHook()` lee señales del sessionStorage
- `renderRoleCard(role, isExplore)` y `renderCompactRoleCard(role, isExplore)` con flag
- Explore: "Qué hace este rol en la práctica" + "Cómo suele verse este rol" (sin herramientas prescriptivas)
- `ROLE_PRACTICE_CONTENT`: 5 roles con contenido específico (Analista Financiero, Analista de Datos, Control de Gestión, Reporting, Asistente Proyectos)
- `getPracticeContent(role)`: busca por título exacto, fallback por área con `ROLE_AREA_EXPECTATIONS`

### Problemas identificados en validación de producto (2026-04-04)

**🔴 Alta prioridad:**
1. Bug `buildExploreResultsHook()`: hardcodea "terreno" en el texto aunque no esté en el array de avoid. El condicional `(isAnalytic) && avoidsClients` produce "clientes o terreno" sin verificar `avoidsTerrain`.
2. Fallback `reality` en `getPracticeContent()` es genérico para los 19 roles sin contenido específico. No aporta valor real.

**🟡 Media prioridad:**
3. Segunda frase de motivación pegada sin hilo al texto principal en `buildExploreResultsHook()`
4. Label "Control de Gestión" en step-explore-areas no es auto-explicativo para egresados recientes
5. step-explore-areas visualmente pesada: 16 items (8×2), sin diferenciación visual entre grids

**🟠 Baja prioridad (preexistente):**
6. `buildRoleAlignment` tautológico en flujo guided para IC: siempre devuelve "Tu base en negocios y gestión es aplicable en la mayoría de áreas funcionales de una organización."

### Prioridades

1. ~~Deploy en Render.com~~ — completado.
2. ~~Ampliar catálogo~~ — completado (24 roles).
3. ~~Simplificar a Ingeniería Comercial~~ — completado.
4. ~~Sprint UX humanización~~ — completado.
5. ~~Sprint flujo explorar — UX, copy, validaciones, pantalla áreas~~ — completado.
6. ~~Fix bug "terreno" + ampliar ROLE_PRACTICE_CONTENT (24 roles) + key howItLooks~~ — completado.
7. ~~AREA_TO_ROLES + filtro de catálogo por área en modo explore~~ — completado.
8. ~~Sprint expansión catálogo: 24 → 44 roles, 10 áreas, badges entry_type, comisiones~~ — completado.
9. ~~Sprint UX step-explore-areas: grupos guiados, cards con descripción, eliminar "evitar"~~ — completado.
10. ~~Sprint motor de matching: behavioral-first, areaBoost soft, avoidPenalty aditiva, diversityTop5~~ — completado.
11. ~~Sprint diversidad y descubrimiento: ROLE_CLUSTERS granulares, diversifyResults con discovery bonus, Compliance reclasificado~~ — completado (2026-04-06).
12. ~~Sprint selección conductual: BEHAVIORAL_INTERESTS reemplaza EXPLORE_AREAS, áreas y traits inferidos~~ — completado (2026-04-06).
13. **Mejorar ROLE_PRACTICE_CONTENT para 44 roles** — pendiente (solo 5 tienen contenido específico).
14. **Refactorizar public/app.js** — ~2500 líneas, deuda técnica real.

Repo en GitHub (público): https://github.com/juanddpalacios-hash/labora-mvp

---

## Estado actual (2026-04-05) — post sprint motor de matching

### Completado — Sprint motor de matching (2026-04-05, commit 835fccd)

**Problema resuelto:**
`AREA_TO_ROLES` actuaba como filtro hard en explore mode → resultados tautológicos (si elegías finanzas, solo veías roles de finanzas independiente del perfil conductual).

**Nueva arquitectura de scoring (solo explore mode):**
```
finalScore = cvScore(0-35) + behavioralScore(0-40) + areaBoost(0-10) - avoidPenalty
```

- **cvScore (0-35):** grado IC→14 pts, skills max 12, experiencia max 5, especialización max 4
- **behavioralScore (0-40):** `buildUserTraitVector(taskPrefs, motivPrefs, interestPrefs)` → vector 8 dims; formula: `min(role,user)*2 - max(gap,0)` por dimensión; rango [-24,+48] → normalizado [0,40]
- **areaBoost (0-10):** +8 área directa seleccionada, +3 área adyacente (mapa `AREA_ADJACENCY`). NO filtra — roles sin área seleccionada reciben 0, no se excluyen
- **avoidPenalty (aditiva):** `AVOID_PENALTY_RULES`: -15 a -40 por condición de traits; acumulable. Ej: Ejecutivo Comercial con ventas+clientes+presión avoids → -100 pts, score cae a 0
- **diversifyResults():** top3 (máx 2/cluster, score-greedy) → #4 (non-top3 cluster, +5 discovery bonus para WIDE_CLUSTERS) → #5 (sort aprendizaje DESC, no score puro)
- **WIDE_CLUSTERS:** control_gestion, operations, projects, people, entrepreneurship, marketing, commercial — reciben +5 en slot #4 para competir con roles analíticos de mayor score
- **Filtro cv_gate:** roles con `requires_cv_gate:true` excluidos del catálogo explore

**8 dimensiones conductuales en cada rol (junior_roles.json):**
analisis, ejecucion, coordinacion, contacto_cliente, social, presion, aprendizaje, movilidad — escala 0-3

**TASK_TO_TRAITS (5 tareas → deltas):**
- analizar-datos → analisis+2, aprendizaje+1
- resolver-problemas → analisis+1, ejecucion+1
- trabajar-personas → social+2, coordinacion+1, contacto_cliente+1
- organizar-procesos → ejecucion+2, coordinacion+1
- crear-estrategias → analisis+1, coordinacion+1, aprendizaje+1

**MOTIVATION_TO_TRAITS (6 motivaciones → deltas, pueden ser negativos):**
- aprender → aprendizaje+2
- crecer-rapido → presion+1, ejecucion+1
- estabilidad → presion-1, movilidad-1
- buen-sueldo → presion+1, contacto_cliente+1
- buen-ambiente → social+1
- impacto → aprendizaje+1, coordinacion+1

**Clusters para diversidad:**
data (analitica, tecnologia) | finance (finanzas) | control_gestion (control-gestion, operaciones) | commercial (comercial, negocios) | marketing (marketing, comunicacion) | operations | projects | people | entrepreneurship

> Nota: "control-gestion" y "operaciones" comparten cluster `control_gestion`. Compliance (`category: operaciones`) vive en este cluster — su clasificación es funcional (proceso/gestión), no académica.

**Umbrales explore:** strong ≥40, stretch 12-39, excluido <12 (max teórico: 75 — sin areaBoost)

**Guided mode:** sin cambios — scoring 6 dimensiones + pesos dinámicos. Umbrales strong ≥65, stretch 25-64.

**analyze.js:** ahora parsea `task_preferences` → `task_prefs` y `motivation_preferences` → `motivation_prefs` del body del formulario.

---

### Completado — Sprint UX step-explore-areas (2026-04-05)

**Cambios:**
- Eliminado el grid "Prefiero evitar" del step-explore-areas
- Cards con título + descripción 1 línea + ejemplos de roles
- Grupos guiados: Analítico | Negocio/Clientes | Operación | Personas | Otros
- Grid 2 columnas en desktop, 1 en mobile
- Check visual (círculo verde) en cards seleccionadas
- Máximo 3 áreas seleccionables; el resto queda disabled al llegar al límite

---

### Completado — Sprint expansión catálogo (2026-04-05)

**Catálogo:** 24 → 44 roles (20 nuevos)
**Áreas:** 8 → 10 (agregadas `tecnologia` y `emprendimiento`)
**Nuevos campos:**
- `entry_type`: "real" | "conditional" | "selective"
- `requires_cv_gate`: true en 4 roles tech/diseño (Dev Web, QA, Soporte TI, UX) — no se muestran en explore
- `has_commission`: true en Ejecutivo Comercial y Ejecutivo de Ventas
- `traits`: objeto con 8 dimensiones conductuales (todos los 44 roles)
**Frontend:**
- Badges: "Accesible de entrada" (verde), "Requiere preparación" (amarillo), "Competitivo" (naranja) — no se muestran si `requires_cv_gate: true`
- Aviso de comisión en card: "Rol con componente variable: incluye cuota o comisión"

---

## Estado actual (2026-04-06) — post sprint selección conductual

### Completado — Sprint selección conductual (2026-04-06, commit 880babf)

**Problema resuelto:**
El paso `step-explore-areas` mostraba categorías explícitas ("Finanzas", "Analítica") que rompían la sensación de descubrimiento personalizado y exponían la arquitectura interna al usuario.

**Principio aplicado:**
> El usuario no elige áreas. Elige cómo quiere trabajar. El sistema infiere las áreas internamente.

**Cambios en `public/app.js`:**
- `EXPLORE_AREAS` + `EXPLORE_AREA_GROUPS` eliminados → reemplazados por `BEHAVIORAL_INTERESTS` (8 opciones)
- `exploreAreasInterest` / `exploreAreasAvoid` → `exploreInterests` (array de IDs, máx 3)
- `renderExploreAreasGrid()` → `renderBehavioralInterestsGrid()`: grid plano, frases conductuales, sin grupos ni labels de área
- **Submit:** `areas_interest` se infiere con unión deduplicada de `item.areas` antes de enviar; `interest_preferences` se envía como nuevo campo
- **`inferAreas()`:** señal de `exploreInterests` (+3 por área por ID) reemplaza señal explícita (+4 por área declarada)
- **`buildConfirmExplanation()`:** clasificador de perfil ahora usa señales de `exploreInterests` (`hasAnalyticInterest`, `hasPeopleInterest`, `hasOpsInterest`, `hasLearningInterest`, `hasStrategyInterest`) en lugar de `areasI`
- **`renderExploreConfirm()`:** cards sin `<h3>` de área; solo descripción conductual. Header: "Con lo que nos contaste, esto parece cercano a cómo te ves trabajando:"

**Cambios en `public/upload.html`:**
- Título: "Pensando en tu día a día, ¿qué tipo de cosas te gustaría estar haciendo?"
- Hint: "Elige al menos una opción para continuar."

**Cambios en `server/routes/analyze.js`:**
- Nuevo campo parseado: `interest_prefs: req.body.interest_preferences ? JSON.parse(...) : []`

**Cambios en `server/services/roleMatcher.js`:**
- `INTEREST_TO_TRAITS`: mapa de 8 IDs → deltas de traits (sincronizado con `BEHAVIORAL_INTERESTS` del frontend)
- `buildUserTraitVector(taskPrefs, motivPrefs, interestPrefs = [])`: tercer parámetro agrega señal de intereses al vector conductual

**`BEHAVIORAL_INTERESTS` — 8 opciones con mapping:**
| ID | Áreas inferidas | Traits |
|---|---|---|
| `entender-datos` | analitica, finanzas | analisis+2, aprendizaje+1 |
| `numeros-negocio` | finanzas, control-gestion | analisis+2 |
| `procesos-ordenados` | operaciones, control-gestion | ejecucion+2, coordinacion+1 |
| `coordinar-avanzar` | proyectos, personas | coordinacion+2, social+1 |
| `cerca-personas` | comercial, personas, marketing | social+2, contacto_cliente+1, coordinacion+1 |
| `mejorar-organizacion` | control-gestion, proyectos, personas | coordinacion+1, ejecucion+1, aprendizaje+1 |
| `aprender-profundo` | analitica, tecnologia, emprendimiento | aprendizaje+3 |
| `crear-impacto` | emprendimiento, proyectos, control-gestion | analisis+1, coordinacion+1, aprendizaje+1 |

### Regla 12. BEHAVIORAL_INTERESTS ↔ INTEREST_TO_TRAITS deben estar sincronizados
Si se agrega, elimina o modifica una opción en `BEHAVIORAL_INTERESTS` (app.js), actualizar también `INTEREST_TO_TRAITS` en `roleMatcher.js`. Son la misma fuente de verdad dividida por razones de arquitectura (frontend/backend).

---

## Estado actual (2026-04-06) — post sprint diversidad y descubrimiento

### Completado — Sprint diversidad y descubrimiento (2026-04-06)

**Problema resuelto:**
Los resultados eran coherentes pero conservadores — variantes del mismo cluster (data/finanzas/reporting). Sin efecto de descubrimiento.

**Cambios en `server/services/roleMatcher.js`:**

1. **`ROLE_CLUSTERS` refactorizado** — clusters granulares funcionales (no académicos):
   ```
   data         → analitica, tecnologia
   finance      → finanzas  (solo finanzas puras)
   control_gestion → control-gestion, operaciones  (procesos + gestión)
   commercial   → comercial, negocios
   marketing    → marketing, comunicacion
   operations   → operaciones (roles operacionales puros)
   projects     → proyectos
   people       → personas
   entrepreneurship → emprendimiento
   ```
   - Analista CdG: `category` cambiado a `"control-gestion"` en junior_roles.json → cluster propio
   - "derecho" eliminado de ROLE_CLUSTERS (Asistente Legal es cv-gated, nunca aparece en explore)

2. **`diversifyResults()` reescrita** (3 cambios):
   - **top3:** igual que antes (score-greedy, máx 2/cluster)
   - **#4:** +5 discovery bonus para `WIDE_CLUSTERS` (control_gestion, operations, projects, people, entrepreneurship, marketing, commercial) → roles de áreas "anchas" pueden competir con roles analíticos de mayor score
   - **#5:** sort por `aprendizaje DESC, score DESC` — no puro por score. Un rol con learn=3 y score=20 gana sobre learn=1 y score=35.

3. **`AREA_ADJACENCY` limpiado:**
   - Eliminadas todas las referencias a "derecho" (dead code)
   - Agregado: `"control-gestion" → ["operaciones"]` y `"operaciones" → ["control-gestion"]`

**Cambios en `data/junior_roles.json`:**

- **Analista Control de Gestión Junior:** `category: "finanzas"` → `"control-gestion"` (cluster propio)
- **Analista de Compliance Junior:**
  - `category: "derecho"` → `"operaciones"` (clasificación funcional, no académica)
  - `area: "Derecho"` → `"Operaciones"`
  - `traits.coordinacion: 1` → `2` (coordinación cross-funcional es clave en compliance)
  - `traits.aprendizaje: 2` → `3` (aprendizaje regulatorio constante)
  - `primary_families`: actualizado a `["negocios","finanzas"]`

**Principio de diseño aplicado:**
> Compliance no es un rol legal puro — lo hacen ICs, auditores, ingenieros civiles. Su clasificación es funcional (proceso/gestión), no académica. No crear clusters artificiales para dar visibilidad: ajustar scoring y traits para que el rol compita por mérito.

**Resultado observable:**
- Perfil analítico (analitica+finanzas): CdG aparece en #4, Performance en #5 (learn=3)
- Perfil procesos (control-gestion+proyectos): Compliance aparece en #4 con areaBoost +3 natural
- Perfil operacional (operaciones+proyectos): Compliance aparece en #3 con areaBoost +8 directo

### Regla 11. Clasificación de roles: funcional, no académica
**Regla:** El `category` de un rol debe reflejar cómo se trabaja, no qué carrera lo estudia.
Compliance = `"operaciones"` porque coordina procesos y cumplimiento normativo.
No usar `"derecho"` aunque el dominio sea legal — los ICs hacen compliance, no abogacía.

---

## Sprint expansión catálogo (2026-04-04) — COMPLETADO

### Objetivo
Expandir `data/junior_roles.json` de 24 → ~43 roles. Pasar de 8 áreas a 10 en `AREA_TO_ROLES` y en `EXPLORE_AREAS` del frontend.

### Nuevas áreas (agregar a EXPLORE_AREAS en app.js)
- `tecnologia` → label: "Tecnología" (BA/Product, no Dev/QA)
- `emprendimiento` → label: "Emprendimiento"

### Roles a agregar al catálogo (19 nuevos, validados como reales en mercado chileno)
| Título | Área | Clasificación |
|---|---|---|
| Analista BI Junior | analitica | Entry condicionado |
| Analista de Inversiones Junior | finanzas | Entry selectivo ⚠️ |
| Analista de Tesorería Junior | finanzas | Entry real |
| Analista de Riesgo Junior | finanzas | Entry condicionado |
| Analista de Presupuestos Junior | finanzas/control-gestion | Entry real |
| Ejecutivo Comercial Junior | comercial | Entry real |
| Ejecutivo de Ventas Junior | comercial | Entry real |
| Key Account Manager Junior | comercial | Entry selectivo ⚠️ |
| Analista de Marketing Digital Junior | marketing | Entry condicionado |
| Analista de Performance Junior | marketing | Entry condicionado |
| Analista de Operaciones Junior | operaciones | Entry condicionado |
| Analista de Supply Chain Junior | operaciones | Entry condicionado |
| Analista de Reclutamiento y Selección Junior | personas | Entry real |
| Analista de Desarrollo Organizacional Junior | personas | Entry condicionado |
| Project Manager Junior | proyectos | Entry condicionado |
| Business Analyst Junior | tecnologia | Entry condicionado |
| Product Analyst Junior | tecnologia | Entry condicionado |
| Analista de Innovación Junior | emprendimiento | Entry selectivo ⚠️ |
| Analista de Nuevos Negocios Junior | emprendimiento | Entry condicionado |
| Venture Analyst | emprendimiento | Entry selectivo ⚠️ |

### Roles eliminados del sprint (no corresponden al perfil IC)
- `Analista GIS Junior` → requiere formación geográfica; no es perfil IC
- `Analista Ambiental Junior` → requiere formación ambiental/química; no es perfil IC
- `Asistente Legal Junior` → requiere conocimiento jurídico; no es perfil IC
- `Data Analyst Junior` → duplicado en inglés de Analista de Datos Junior

### Roles con brecha de perfil (mantener en catálogo, mostrar solo con señales CV)
- Desarrollador Web Junior, QA Tester Junior, Analista de Soporte TI Junior, Diseñador UX/UI Junior
- Regla: NO mostrar en modo explore. En guided, solo si el CV tiene señales tech/diseño.

### Clasificación de roles — framework de producto
- **Entry real:** accesible sin experiencia previa relevante. Primer trabajo típico.
- **Entry condicionado:** posible como primer trabajo, pero requiere algo adicional (certificaciones, práctica, herramientas específicas).
- **Entry selectivo ⚠️:** existe en el mercado, pero competitivo o con barreras claras (notas, inglés, práctica previa, redes). NO eliminar — mostrar con contexto honesto.
- **Con brecha de perfil:** posible para IC con autoaprendizaje, pero IC no lo forma directamente.

### Principio de producto (NO olvidar)
> "No ocultar caminos difíciles. Explicarlos."
> Entry selectivo ≠ eliminar. El usuario debe saber que el camino existe y qué requiere.

### Decisiones tomadas (resueltas en sprint)
1. Roles con brecha de perfil → mantener con `requires_cv_gate: true`. No mostrar en explore.
2. Roles Entry selectivo ⚠️ → badge visual "Competitivo" en card.
3. Roles comisionales → aviso `.role-commission-notice` en card.

### Roles que compiten internamente (pitches deben ser distintos)
- CdG + Reporting + Presupuestos → mismo perfil, distintos énfasis. Pitches deben diferenciarlos.
- Marketing Digital + Performance → Digital ejecuta campañas, Performance mide retorno.
- Asistente Proyectos + PM Junior → PM Junior lidera, Asistente apoya.
- Logística + Supply Chain → Logística mueve mercancías, SC planifica el flujo.
- Ejecutivo Comercial + Ejecutivo de Ventas → Comercial: B2B hunting. Ventas: cartera asignada.

### AREA_TO_ROLES objetivo (10 áreas, post-sprint)
```
analitica:       Analista de Datos Junior, Analista de Reporting Junior,
                 Analista Comercial Junior, Analista BI Junior

finanzas:        Analista Financiero Junior, Asistente Contable Junior,
                 Analista de Tesorería Junior, Analista de Presupuestos Junior,
                 Analista de Riesgo Junior, Analista de Inversiones Junior

control-gestion: Analista Control de Gestión Junior, Analista de Reporting Junior,
                 Analista Financiero Junior, Analista de Presupuestos Junior

comercial:       Analista Comercial Junior, Ejecutivo Comercial Junior,
                 Ejecutivo de Ventas Junior, Key Account Manager Junior,
                 Analista de Customer Success Junior

marketing:       Analista de Marketing Junior, Analista de Marketing Digital Junior,
                 Analista de Performance Junior, Community Manager Junior,
                 Redactor de Contenidos Junior

operaciones:     Coordinador de Operaciones Junior, Analista de Logística Junior,
                 Analista de Supply Chain Junior, Analista de Operaciones Junior

personas:        Asistente de RRHH Junior, Analista de Reclutamiento y Selección Junior,
                 Analista de Desarrollo Organizacional Junior, Coordinador Académico Junior

proyectos:       Asistente de Proyectos Junior, Project Manager Junior,
                 Analista de Compliance Junior, Coordinador de Operaciones Junior

tecnologia:      Business Analyst Junior, Product Analyst Junior

emprendimiento:  Analista de Innovación Junior, Analista de Nuevos Negocios Junior,
                 Venture Analyst
```

---

## Estado actual (2026-04-06) — post sprint latent profile

### Completado — Sprint latent profile (2026-04-06, commits f575ad6 → eb3a63f)

**Problema resuelto:**
`scoreAreaBoost()` producía double-counting: los behavioral interests ya influían en `behavioralScore` vía `INTEREST_TO_TRAITS`, y además inflaban `areaBoost` vía `areas_interest`. La misma señal amplificaba los mismos roles por dos rutas.

**Principio aplicado:**
> Las áreas no son input del ranking. Son interpretación posterior del resultado.

**Cambios en `server/services/roleMatcher.js`:**
- `scoreAreaBoost()` eliminado del `finalScore` (función existe pero no se invoca)
- Fórmula nueva: `cvScore + behavioralScore - avoidPenalty - pgPenalty` (max 75)
- Thresholds recalibrados: `EXPLORE_STRONG = 40`, `EXPLORE_STRETCH = 12`
- `area_boost` eliminado del `score_breakdown`
- Nueva función `buildExploreContextMessage(topRoles)`: deriva copy desde clusters del top-5
  - 1 cluster → `"Hay señales claras de que te calzan roles donde [cómo se trabaja]."`
  - 2 clusters → `"Vemos una mezcla entre roles donde [X] y otros donde [Y]."`
  - 3+ clusters → `"Hoy aparecen varias direcciones posibles: [X], [Y], [Z]."`
  - Usa `CLUSTER_WORK_LABELS` (frases de cómo se trabaja) y `CLUSTER_WORK_SHORT` — NO etiquetas de área
- `user_type` eliminado del return de explore mode (ya no se usa para el mensaje)

**Cambios en `public/app.js`:**
- `areas_interest` eliminado del form submit — ya no se envía ni se usa en el motor
- `selectedInferredAreas` eliminado (variable global + toda su lógica)
- `step-explore-confirm` reconvertido a paso de reflexión UX sin selección requerida:
  - Muestra `buildConfirmExplanation()` (perfil conductual en lenguaje natural — sin cambios)
  - Muestra `buildTraitDirections()`: 2 orientaciones derivadas del vector de traits del usuario
  - `TRAIT_DIRECTIONS`: 5 orientaciones con título + bajada práctica del día a día
  - Botón siempre habilitado — no bloquea el flujo ni afecta el backend

**Cambios en `public/styles.css`:**
- Nuevas clases: `.explore-confirm-direction`, `.explore-confirm-direction-title`, `.explore-confirm-direction-desc`

**Flujo resultante:**
```
Respuestas conductuales
  → buildUserTraitVector()
  → score = cvScore + behavioralScore - avoidPenalty - pgPenalty (max 75)
  → diversifyResults() — sin cambios (opera sobre clusters)
  → Top 5
  → buildExploreContextMessage(top5) — clusters como output interpretativo
```

### Regla 13. areas_interest ya no afecta el ranking
`areas_interest` NO se envía desde el frontend ni se usa en el motor de scoring.
Los clusters/áreas solo existen como interpretación posterior al ranking, derivados de los roles ganadores.
No reintroducir `scoreAreaBoost()` ni equivalente oculto. El `score_breakdown` solo contiene: `cv`, `behavioral`, `avoid_penalty`.

---

## Estado actual (2026-04-07) — post sprint simplificación de flujo

### Completado — Sprint simplificación de flujo (2026-04-07)

**Objetivo:** Reducir fricción en el onboarding eliminando preguntas que no aportaban señal diferenciadora al motor.

#### Subpreguntas de etapa eliminadas

- **Último año (estudiante):** pregunta condicional eliminada de `step-2`. `isLastYear` removido del payload, de `analyze.js` y de toda la lógica JS.
- **Postgrado (titulado):** pregunta condicional eliminada. `has_postgrad` ahora proviene solo del CV (extractor). `formPostgrad` hardcodeado a `false` en `analyze.js`.
- `pgPenalty` sigue activa — la señal ahora es solo del CV, no del formulario.

#### Paso ciudad + modalidad eliminado (step-5 completo)

- `CITIES`, `initCityAutocomplete()`, `initModality()`, `getCheckedValues()` eliminados de `app.js`.
- `city`, `region`, `desiredModality` eliminados del payload y de `analyze.js`.
- `next-4` ahora bifurca: explore → `form.requestSubmit()`, guided → step 6 (resumen).
- `back-6` ahora vuelve a step 4.
- `TOTAL_STEPS`: 5 → 4 (guided). Explore: 9 → 7 pasos totales.

#### Pantalla unificada intereses + tareas (step-explore-areas + step-explore-1 → una pantalla)

**Principio:** reducir la cantidad de pantallas sin perder señal. Los dos arrays siguen siendo independientes.

- `EXPLORE_STEP_IDS`: `["step-explore-areas", "step-explore-2", "step-explore-3", "step-explore-confirm"]` (step-explore-1 eliminado).
- **Bloque A** (QUÉ te interesa): `exploreInterests[]` — `BEHAVIORAL_INTERESTS`, máx 3. Label: "¿Qué tipo de cosas te gustaría estar haciendo en tu día a día?"
- **Bloque B** (CÓMO trabajas): `exploreTaskPrefs[]` — `EXPLORE_TASKS`, máx 2. Label: "Cuando trabajas, ¿qué forma de hacerlo se te hace más natural?"
- Separados por `<hr class="explore-block-divider">` + línea de transición: "Ahora, más allá del tipo de trabajo, pensemos en cómo te gusta trabajar."
- Botón `next-explore-areas` valida ambos arrays antes de avanzar.
- `updateCombinedNext()`: botón deshabilitado hasta que cada bloque tiene ≥1 selección.

**Labels Bloque B (EXPLORE_TASKS) — estilo conductual primera persona:**
| Value | Label visible |
|---|---|
| `analizar-datos` | Analizo antes de actuar y entiendo bien el problema |
| `resolver-problemas` | Avanzo probando, iterando y ajustando en el camino |
| `trabajar-personas` | Colaboro con otros y hago que las cosas avancen |
| `organizar-procesos` | Organizo y estructuro para que todo funcione bien |
| `crear-estrategias` | Tomo decisiones y priorizo con una mirada estratégica |

**Scoring sin cambios:** `exploreInterests` → `interest_preferences` → `metadata.interest_prefs` → `INTEREST_TO_TRAITS`. `exploreTaskPrefs` → `task_preferences` → `metadata.task_prefs` → `TASK_TO_TRAITS`. Ambos entran por separado a `buildUserTraitVector()`.

**Pantalla unificada CERRADA:** no más cambios funcionales, semánticos ni de UX. Ajustes visuales/diseño se revisarán después.

### Regla 14. Pantalla unificada intereses+tareas: no mezclar arrays
`exploreInterests[]` y `exploreTaskPrefs[]` son señales distintas con mapas distintos. No fusionar ni redirigir una al array de la otra. El contrato con el motor es fijo.

---

## Estado actual (2026-04-07) — post sprint cv_weight

### Completado — Sprint cv_weight: modulación de señal del CV (2026-04-07, commit 854dfcb)

**Problema resuelto:**
El CV podía introducir ruido en el scoring (trabajos part-time irrelevantes → skills/exp falsos) y competir con la señal conductual que es el núcleo del motor.

**Principio aplicado:**
> El grado siempre suma. El behavioral siempre manda. El CV refuerza cuando es relevante y se apaga cuando no lo es.

**Nueva fórmula (explore mode):**
```
finalScore = degreePts(estable) + (cvSignal × cv_weight) + behavioralScore - penalties
```
- `degreePts`: siempre 14 para IC. No modulado — es señal formativa, no de calidad del CV.
- `cvSignal = cvResult.cv - degreePts`: skills + exp + spec (0-21). Solo esta parte se modera.
- `cv_weight`: 0.2 (low) / 0.6 (medium) / 1.0 (high). Viene de declaración explícita del usuario.
- Sin CV: `cvSignal = 0` → `cv_weight` irrelevante. Comportamiento idéntico al actual.

**Cambios en `server/routes/analyze.js`:**
- Lee `req.body.cv_relevance` ("low" | "medium" | "high")
- Mapea a `cv_weight`: `{ low: 0.2, medium: 0.6, high: 1.0 }`
- Default: 1.0 si hay CV pero no se declaró relevancia
- Pasa `cv_weight` en `metadata` a `matchRoles()`

**Cambios en `server/services/roleMatcher.js`:**
- Lee `metadata.cv_weight` (default 1.0)
- Separa `degreePts` de `cvSignal` dentro del explore loop
- Aplica: `cvScore = degreePts + Math.round(cvSignal × cv_weight)`
- Agrega `cv_weight` al `score_breakdown` para trazabilidad

**Cambios en `public/upload.html`:**
- Nuevo copy step-4: "Puedes agregar tu CV si crees que aporta información relevante..."
- Nueva sección `#cv-relevance-section` (hidden por defecto): 3 cards de relevancia con `data-relevance="low|medium|high"`
- `<input type="hidden" id="cvRelevanceInput" name="cv_relevance">`

**Cambios en `public/app.js`:**
- Variable global `cvRelevance = null`
- `updateNext4State()`: habilita siguiente solo cuando `cvChoice="no"` OR (`cvChoice="yes"` AND archivo seleccionado AND relevancia elegida)
- Listener en `cvFileInput.change` para actualizar estado del botón
- Listeners en cards de relevancia → setean `cvRelevance` + hidden input
- Submit: `if (cvRelevance) formData.append("cv_relevance", cvRelevance)`

**Invariantes garantizados:**
- `aiExtractor.js` sin cambios
- `scoreCv()`, `scoreDegree()`, `scoreSkills()` sin cambios
- `buildUserTraitVector()` sin cambios
- Guided mode sin cambios
- Un CV con relevancia "low" nunca score menor que sin CV (floor = degreePts = 14)

### Regla 15. cvSignal ≠ degreeScore
`degreePts` (14 para IC) es señal formativa, siempre estable. `cvSignal = cvResult.cv - degreePts` es la única parte modulable por `cv_weight`. No confundir ni mezclar.

### Prioridades actuales (2026-04-07)
1. ~~Sprints 1-21~~ — todos completados
22. ~~Sprint domain fit~~ — completado (2026-04-08)
23. **Mejorar ROLE_PRACTICE_CONTENT para 44 roles** — solo 5 tienen contenido específico
24. **Refactorizar public/app.js** — ~2500 líneas, deuda técnica real
25. **Tests end-to-end en Render** — verificar flujo completo post sprint domain fit

---

## Estado actual (2026-04-08) — post sprint domain fit

### Completado — Sprint domain fit (2026-04-08)

**Problema resuelto:**
El motor detectaba bien señales conductuales pero no filtraba por contexto profesional base. Roles como Coordinador Académico o Relacionador Público podían aparecer en el top 5 para perfiles IC si sus traits calzaban, aunque el dominio profesional no correspondiera.

**Principio aplicado:**
> Domain fit es ajuste de contexto, no redefinición del perfil. behavioralScore sigue siendo el driver principal.

**Nueva fórmula explore (post sprint):**
```
score_base = cvScore + behavioralScore - avoidPenalty - pgPenalty
→ top 20 ordenados por score_base
→ domain_fit_modifier aplicado a cada uno de los 20
→ re-sort por score_ajustado
→ diversifyResults() → top 5
```

**Cambios en `data/junior_roles.json`:**
- Campo `domain` agregado a los 44 roles (string, un dominio por rol)
- Taxonomía: `finance | commercial | marketing | analytics | business_general | operations | people_org | tech | education | communications`

**Cambios en `server/services/roleMatcher.js`:**
- `DOMAIN_FIT_MAP`: mapa `carrera → { natural, nearby, distant }` — solo IC implementado
- `DOMAIN_MODIFIERS`: `{ natural: +5, nearby: 0, distant: -4 }`
- `getDomainFitModifier(userCareer, roleDomain)`: lookup simple, default 0 si carrera/dominio no en mapa
- Pipeline explore: aplica modifier al top 20 post-sort, re-sort, luego `diversifyResults()`
- `score_breakdown.domain_fit` incluido para trazabilidad

**Clasificación IC:**
| Clasificación | Dominios | Modificador |
|---|---|---|
| natural | finance, commercial, marketing, analytics, business_general | +5 |
| nearby | operations, people_org, tech | 0 |
| distant | education, communications | -4 |

**Mapeo roles → domain (resumen):**
- finance: Analista Financiero, CdG, Tesorería, Riesgo, Presupuestos, Inversiones, Asistente Contable
- commercial: Ej. Comercial, Ej. Ventas, KAM, Analista Comercial, Customer Success
- marketing: Analista Marketing, Mktg Digital, Performance
- analytics: Datos, Reporting, BI, Product Analyst
- business_general: Nuevos Negocios, Innovación, Venture Analyst, Asistente Legal
- operations: Coord. Operaciones, Logística, Supply Chain, Analista Ops, Compliance
- people_org: RRHH, Reclutamiento, DO, Asistente Proyectos, PM Junior
- tech: Dev Web, QA, Soporte TI, Business Analyst
- education: Coordinador Académico (−4 para IC)
- communications: Community Manager, Redactor, Relacionador Público (−4 para IC)

**Resultados verificados:**
- Control de Gestión (finance, +5): aparece top 5 para IC analítico ✅
- Coordinador Académico (education, −4): NO aparece en top visible ✅
- Customer Success (commercial, +5): aparece #1 cuando behavioral lo justifica ✅
- Relacionador Público (communications, −4): penalizado, fuera del top 5 ✅

**Invariantes:**
- `behavioralScore` sin cambios
- `cvScore`, `cv_weight` sin cambios
- `diversifyResults()` sin cambios (opera sobre scores ya ajustados)
- Guided mode sin cambios
- Un rol distant con behavioral muy alto puede aún aparecer si supera 4 pts de ventaja

### Regla 16. domain_fit: aplicar solo al top 20, nunca al catálogo completo
La capa domain fit actúa sobre `allScored.slice(0, 20)` — roles ya rankeados por score base.
No aplicar domain fit antes del scoring base ni sobre el catálogo completo.
Si se agrega soporte para otra carrera, agregar un nuevo key en `DOMAIN_FIT_MAP` sin modificar los existentes.
`score_breakdown.domain_fit` solo existe en los primeros 20 roles; ausente (undefined) en el resto.

---

## Estado actual (2026-04-10) — post sprint scoring refinement + UX labels

### Completado — Sprint scoring refinement (2026-04-10, commits 863ccad → 10b1d49)

**Problemas resueltos:**
1. Mutación de `allScored` en domain fit → reemplazado por `.map()` con spread
2. Compliance sobre-representado para perfiles genéricos analíticos/ordenados
3. Penalizaciones comerciales no cubrían roles con bajo `contacto_cliente`
4. CV weight poco gradual (rango 0.2–1.0 demasiado amplio)

**Cambios en `server/services/roleMatcher.js`:**

**`ROLE_INTENT_GATE` (nuevo):**
- Compliance (`analista-compliance-junior`): requiere `numeros-negocio` en interests. Absent penalty: 28. Sin esta señal, compliance score ~7 → filtrado (EXPLORE_STRETCH=12).
- CdG (`analista-control-gestion-junior`): requiere `numeros-negocio`, `procesos-ordenados`, `mejorar-organizacion` (interests) o `organizar-procesos`, `crear-estrategias` (tasks). Absent penalty: 15.
- Comentario explícito en compliance: proxy temporal hasta que exista señal regulatoria real.
- `score_breakdown.intent_gate_penalty` para trazabilidad.

**`AVOID_PENALTY_RULES` reforzado:**
- `atencion-clientes`: nueva regla `contacto_cliente >= 1 → -8` (cobertura suave)
- Eliminada regla `ventas-metas, contacto_cliente >= 1 && presion >= 2 → -10` (falsos positivos en Product Analyst, BA, Ops)

**Domain fit inmutable:**
- `.slice(0,20).forEach(r => r.score = ...)` → `.map()` con spread. `allScored` original intacto.
- `reRanked = [...topN.sort(), ...rest]` pasa a `diversifyResults`.

**Cambios en `server/routes/analyze.js`:**
- cv_weight: `{ low: 0.2, medium: 0.6, high: 1.0 }` → `{ low: 0.35, medium: 0.65, high: 0.85 }`. Rango efectivo: 16.8 pts → 10.5 pts.

**Cambios en `data/junior_roles.json`:**
- Compliance: `domain: "operations"` → `"finance"` (rigor financiero-regulatorio, natural +5 para IC)

**Comportamiento verificado:**
- Ops puro sin `numeros-negocio`: compliance filtrado (score 7) ✅
- Data puro: compliance filtrado, top = Datos/BI ✅
- Finance con `numeros-negocio`: compliance habilitado, no domina (Inversiones lo desplaza en cluster) ✅
- Product Analyst, BA: avoid_penalty=0 con penalizaciones comerciales ✅

### Completado — Sprint UX labels (2026-04-10, commit f58313a)

**Problema resuelto:**
Labels de BEHAVIORAL_INTERESTS eran semánticamente redundantes y no discriminaban DATA vs NEGOCIO vs OPS. Perfiles de ops/estructura seleccionaban opciones que empujaban señales financieras sin intención.

**Cambios en `public/app.js` (solo labels, IDs y traits sin cambios):**

| ID | Label anterior | Label nuevo |
|---|---|---|
| `entender-datos` | "Entender qué hay detrás de la información..." | "Explorar datos, encontrar patrones y convertir eso en algo que sirva para decidir" |
| `numeros-negocio` | "Trabajar con los números de un negocio para saber si va bien o mal" | "Analizar cómo le va al negocio — ventas, costos, resultados — y apoyar decisiones con esa información" |
| `procesos-ordenados` | "Hacer que las cosas se hagan bien, de forma ordenada y consistente" | "Asegurar que los procesos del día a día funcionen de forma eficiente" |
| `coordinar-avanzar` | "Coordinar personas o proyectos..." | "Coordinar equipos o proyectos y hacer que las cosas avancen hacia un objetivo concreto" |
| `cerca-personas` | "Estar en contacto con personas y ayudar..." | "Trabajar directamente con personas — clientes, usuarios, equipos — y ayudarlas a resolver lo que necesitan" |
| `mejorar-organizacion` | "Entender cómo funciona una organización por dentro..." | "Diagnosticar cómo funciona un equipo u organización y proponer mejoras concretas" |
| `aprender-profundo` | "Investigar cómo funcionan las cosas, aprender en profundidad..." | "Profundizar en temas hasta entenderlos de raíz, aunque tome tiempo" |
| `crear-impacto` | "Pensar en cómo crear algo nuevo, hacer crecer un negocio..." | "Crear o hacer crecer algo desde cero — un proyecto o negocio propio" |
| `analizar-datos` (task) | "Analizo antes de actuar y entiendo bien el problema" | "Analizo el problema a fondo antes de proponer o actuar" |
| `trabajar-personas` (task) | "Colaboro con otros y hago que las cosas avancen" | "Trabajo codo a codo con otros para que las cosas avancen" |

**Pendiente de validación:** si ops puro sigue cayendo en finance con los nuevos labels, el problema está en trait mapping (`ejecucion + coordinacion` compartidos entre ops y finanzas estructuradas), no en UX. Testeo en curso.

### Regla 17. ROLE_INTENT_GATE: proxy temporal para compliance
Compliance usa `numeros-negocio` como único habilitador porque no existe señal de regulación/normativa en el sistema. NO implica que compliance = finanzas. Cuando se agregue una dimensión regulatoria al cuestionario, actualizar `ROLE_INTENT_GATE["analista-compliance-junior"].required_signals`.

### Regla 18. Domain fit: usar map, no forEach
`allScored.slice(0,20)` se convierte en `topN` vía `.map()` con spread. Nunca mutar objetos de `allScored` directamente. `reRanked = [...topN.sort(), ...rest]`.

---

## Estado actual (2026-04-10) — post sprint signal-aware domain modifier

### Completado — Sprint signal-aware domain modifier (2026-04-10, commit a6171ce)

**Problema resuelto:**
El domain fit daba +5 a todos los roles "natural" para IC de forma uniforme, sin importar si el usuario declaró señales de interés hacia ese dominio. Esto producía tres falsos positivos estructurales:
1. **DATA puro → Riesgo**: Riesgo tiene traits idénticos a Datos (ana:3, apr:3) + domain finance (+5), igualaba el score.
2. **NEGOCIO puro → Datos/BI**: analytics domain recibía +5 aunque el usuario no tenía señal analítica.
3. **OPS puro → Contable/Tesorería**: finance domain +5 superaba ops domain 0, roles financieros ganaban a roles operacionales.

**Principio aplicado:**
> El domain fit no es fijo por carrera. Depende de si el usuario declaró señales de interés hacia ese dominio.

**Cambios en `server/services/roleMatcher.js`:**

**`DOMAIN_SIGNAL_MAP` (nuevo):**
```js
const DOMAIN_SIGNAL_MAP = {
  analytics:       ["entender-datos", "aprender-profundo"],
  finance:         ["numeros-negocio"],
  operations:      ["procesos-ordenados"],
  commercial:      ["cerca-personas"],
  marketing:       ["cerca-personas", "crear-impacto"],
  people_org:      ["coordinar-avanzar", "cerca-personas", "mejorar-organizacion"],
  projects:        ["coordinar-avanzar"],
  tech:            [],
  business_general:["crear-impacto"],
  education:       [],
  communications:  ["cerca-personas"]
};
```

**`DOMAIN_MODIFIERS` actualizado (3 → 5 valores):**
```js
const DOMAIN_MODIFIERS = {
  natural:       5,   // natural + señal declarada
  natural_weak:  2,   // natural + sin señal
  nearby_strong: 4,   // nearby + señal declarada
  nearby:        0,   // nearby + sin señal
  distant:      -4    // sin cambios
};
```

**`getDomainFitModifier` (firma actualizada + lógica signal-aware):**
```js
function getDomainFitModifier(userCareer, roleDomain, userInterests = []) {
  const norm = normalizeText(userCareer || "");
  const careerMap = DOMAIN_FIT_MAP[norm];
  if (!careerMap || !roleDomain) return 0;
  const domainSignals = DOMAIN_SIGNAL_MAP[roleDomain] || [];
  const hasSignal = domainSignals.length > 0 && domainSignals.some(s => userInterests.includes(s));
  if (careerMap.natural.includes(roleDomain))
    return hasSignal ? DOMAIN_MODIFIERS.natural : DOMAIN_MODIFIERS.natural_weak;
  if (careerMap.nearby.includes(roleDomain))
    return hasSignal ? DOMAIN_MODIFIERS.nearby_strong : DOMAIN_MODIFIERS.nearby;
  if (careerMap.distant.includes(roleDomain))
    return DOMAIN_MODIFIERS.distant;
  return 0;
}
```

**Pipeline:** se pasa `interestPrefs` a `getDomainFitModifier()` en el loop del top 20.

**Comportamiento verificado:**
- DATA puro (`entender-datos`, `aprender-profundo`): Datos/BI +5, Riesgo (finance, sin señal) +2. Datos gana por 3 pts. ✅
- NEGOCIO puro (`numeros-negocio`): Riesgo/Inversiones +5, Datos/BI (analytics, sin señal) +2. Finance domina. ✅
- OPS puro (`procesos-ordenados`): Analista Ops (operations, +4 nearby+signal) > Contable/Tesorería (finance, +2 natural_weak). OPS gana. ✅
- Compliance (finance, +5): solo habilitado con `numeros-negocio` (ROLE_INTENT_GATE). ✅

### Regla 19. DOMAIN_SIGNAL_MAP: solo interests, no tasks
`DOMAIN_SIGNAL_MAP` usa IDs de BEHAVIORAL_INTERESTS (interests), NO de EXPLORE_TASKS (tasks).
Las tasks describen el estilo de trabajo (cómo), no el dominio de interés (qué). No agregar task IDs a DOMAIN_SIGNAL_MAP.

### Regla 20. domain_fit_modifier: 5 valores, no 3
`getDomainFitModifier` devuelve uno de: +5 (natural+señal), +2 (natural_weak), +4 (nearby_strong), 0 (nearby), -4 (distant).
No asumir que "natural siempre da +5". Depende de `userInterests`. Verificar con `score_breakdown.domain_fit`.

### Prioridades actuales (2026-04-10)
1-26: todos completados (último: sprint signal-aware domain modifier)
27. ~~Eliminar botones "Ver ofertas" y "Crear CV" de cards~~ — completado (2026-04-11, commit 533b256)
28. **Señal de regulación/normativa** — reemplazar proxy `numeros-negocio` en ROLE_INTENT_GATE de compliance
29. **ROLE_PRACTICE_CONTENT para 44 roles** — solo 5 tienen contenido específico
30. **Refactorizar public/app.js** — ~2500 líneas, deuda técnica real

### Decisiones de scope MVP (2026-04-11)
- **Vacantes (`/vacantes.html`)**: no implementado en MVP. Botón "Ver ofertas de este tipo" eliminado de todas las cards de resultado.
- **CV builder (`/cv-builder.html`)**: no implementado en MVP. Botón "Crear/Optimizar CV para este rol" eliminado de todas las cards de resultado.
- Afecta 4 variantes de card: explore principal, guided principal, explore compacta, guided compacta.
- Función `cvBuilderLabel()` eliminada (dead code).

---

## Comandos frecuentes

```bash
pm2 restart labora-mvp       # reiniciar servidor tras cambios
pm2 logs labora-mvp          # ver logs en tiempo real
pm2 status                   # estado del proceso

# Test guided mode (sin CV)
curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d "{\"degree\":\"Ingenieria Comercial\",\"academicStatus\":\"titulado\",\"city\":\"Santiago\",\"user_intent_mode\":\"guided\",\"desiredModality\":\"[]\",\"areasOfInterest\":\"[{\\\"value\\\":\\\"finanzas\\\",\\\"weight\\\":3}]\"}" \
  > C:/Temp/result.json && node -e "const d=JSON.parse(require('fs').readFileSync('C:/Temp/result.json','utf8')); console.log('roles:', (d.matches?.strong_matches?.length||0)+(d.matches?.stretch_matches?.length||0), '| user_type:', d.matches?.user_type)"

# Test explore mode con señales conductuales (latent profile — sin areas_interest)
curl -s -X POST http://localhost:3000/api/analyze \
  -F "degree=Ingenieria Comercial" \
  -F "academicStatus=egresado" \
  -F "city=Santiago" \
  -F "user_intent_mode=explore" \
  -F 'interest_preferences=["entender-datos","aprender-profundo"]' \
  -F 'task_preferences=["analizar-datos","resolver-problemas"]' \
  -F 'motivation_preferences=["aprender","crecer-rapido"]' \
  -F 'avoid_preferences=["ventas-metas","atencion-clientes"]' \
  > C:/Temp/explore.json && node -e "
const d=JSON.parse(require('fs').readFileSync('C:/Temp/explore.json','utf8'));
const all=[...(d.matches?.strong_matches||[]),...(d.matches?.stretch_matches||[])];
console.log('headline:', d.matches?.context_message?.headline);
all.forEach(r => { const sb=r.score_breakdown; console.log(r.score+' '+r.title+' cv:'+sb.cv+' beh:'+sb.behavioral+' avoid:-'+sb.avoid_penalty); });
"
```
