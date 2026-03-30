# CLAUDE.md — Labora MVP

Reglas operativas para este proyecto. Actualizar tras cada corrección o sesión significativa.
Notas detalladas del proyecto: `.notes/project-log.md`

---

## Contexto del proyecto

Motor de matching laboral para egresados chilenos. Stack: Node.js + Express + multer + vanilla JS frontend.
Servidor activo en PM2, puerto 3000. Comando: `pm2 restart labora-mvp`.

Archivos clave:
- `server/services/roleMatcher.js` — motor de scoring (6 dimensiones, pesos dinámicos)
- `server/routes/analyze.js` — POST /api/analyze, recibe CV + metadatos del formulario
- `server/services/aiExtractor.js` — extrae perfil estructurado del texto del CV
- `data/junior_roles.json` — catálogo de 11 roles junior con required_skills, families, etc.
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
**Umbral actual:** `STRETCH_THRESHOLD = 35`, `STRONG_THRESHOLD = 65`.

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

### 6. Variables `let` en express handlers: scope dentro de try
**Regla general:** Declarar con `let` fuera de cualquier `if`/bloque todas las variables que se usen en el `return` del handler. No asumir que el scope de `const` dentro de un `if` es visible afuera.

---

## Principios de diseño del motor (no cambiar sin razón)

- **Degree score ≠ evidencia de especialización.** El grado abre la puerta; skills/exp/spec la acreditan.
- **Normalización por totalWeightSum.** Garantiza escala 0-100 independiente de la configuración de pesos.
- **Penalización ×0.6 en vez de exclusión.** Sin overlap formativo → score reducido, no descartado.
- **required_skills vs skills.** `required_skills` = las indispensables (subset). `skills` = todas las deseables. `buildMissingSkills` usa solo `required_skills`.
- **GetOnBoard solo para analitica/tecnologia.** La plataforma es de tech; aplicar a otros roles genera ruido.

---

## Comandos frecuentes

```bash
pm2 restart labora-mvp       # reiniciar servidor tras cambios
pm2 logs labora-mvp          # ver logs en tiempo real
pm2 status                   # estado del proceso

# Test rápido (sin CV, sin caracteres especiales)
curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","degree":"Ingenieria Comercial","academicStatus":"titulado","city":"Santiago","desiredModality":"[]","areasOfInterest":"[{\"value\":\"finanzas\",\"weight\":3}]"}' \
  | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('roles:', (d.matches?.strong_matches?.length||0)+(d.matches?.stretch_matches?.length||0), '| user_type:', d.matches?.user_type)"
```
