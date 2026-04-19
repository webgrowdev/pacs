/**
 * Corrector ortográfico médico en español — Sección 19
 *
 * Implementa un corrector ortográfico con terminología médica en español.
 * Funciona en el navegador sin dependencias externas:
 *
 *  1. Usa el corrector ortográfico nativo del navegador (lang="es") para
 *     detectar palabras dudosas mediante el TextMetrics API / contenteditable.
 *  2. Mantiene un diccionario de términos médicos en español que se excluyen
 *     del marcado (falsos positivos comunes para diccionarios estándar).
 *  3. Implementa una validación JS liviana para términos claramente erróneos.
 */

/** Diccionario de términos médicos en español que NO deben marcarse como error */
export const MEDICAL_DICTIONARY: ReadonlySet<string> = new Set([
  // Anatomía
  'abdomen', 'abdominal', 'adenomegalia', 'aorta', 'aórtico', 'axila', 'axilar',
  'bronquio', 'bronquial', 'bronquiolo', 'bronquiolos', 'carina', 'cefálico',
  'cerebelo', 'cerebeloso', 'clavícula', 'clavicular', 'cóccix', 'córtex',
  'costoprénico', 'costofrénico', 'diafragma', 'diafragmático', 'duodeno', 'duodenal',
  'endometrio', 'epididimo', 'epiplón', 'esternón', 'esternal', 'fémur', 'femoral',
  'fibula', 'fíbula', 'fosa', 'gallbladder', 'gástrico', 'glúteo', 'gonada',
  'gónada', 'hígado', 'hilio', 'hiliar', 'hipocondrio', 'hipófisis', 'hipotálamo',
  'iliaco', 'ilíaco', 'ilion', 'íleon', 'ileum', 'ingle', 'inguinal', 'isquion',
  'isquiotibial', 'lúmen', 'mediastino', 'mediastinal', 'menisco', 'mesenterio',
  'miometrio', 'miotomo', 'ombligo', 'omento', 'omóplato', 'parénquima', 'parenquimatoso',
  'patela', 'peritoneo', 'peritoneal', 'pericardio', 'pericárdico', 'periostio',
  'perirrenal', 'pleura', 'pleural', 'porta', 'portal', 'pubis', 'pubiano', 'radio',
  'recto', 'rectal', 'retroperitoneal', 'retroperitoneo', 'rodilla', 'sacro', 'sacral',
  'seno', 'sigmoides', 'sinovia', 'sinovial', 'tálamo', 'trocánter', 'tronco',
  'uréter', 'ureteral', 'uretra', 'uretral', 'útero', 'uterino', 'vejiga', 'vesical',
  'vena', 'venoso', 'vesícula', 'vesicular', 'xifoides', 'xifoidea', 'zigoma', 'zigomático',

  // Modalidades y técnicas de imagen
  'angiografía', 'angioresonancia', 'cistografía', 'colangiografía', 'colonoscopia',
  'densitometría', 'ecocardiograma', 'ecocardiografía', 'ecografía', 'ecográfico',
  'ecotomografía', 'endoscopia', 'endoscópico', 'enterografía', 'escintigrafía',
  'espectroscopia', 'fluoroscopía', 'fluoroscopia', 'gammagrafía', 'histerosalpingografía',
  'laringoscopia', 'mamografía', 'mielografía', 'pielografía', 'pielograma',
  'radiografía', 'radiológico', 'radiológica', 'resonancia', 'scintigrafía',
  'tomografía', 'tomográfico', 'tomodensi', 'ultrasonido', 'urografía', 'venografía',

  // Hallazgos radiológicos
  'adenopatía', 'adenopatías', 'aterosclerosis', 'aterosclerótico', 'atelectasia',
  'atelectásico', 'bronquiectasia', 'bronquiectasias', 'calcificación', 'calcificaciones',
  'cardiomegalia', 'cavitación', 'colección', 'condensación', 'derrame', 'edema',
  'ectasia', 'efusión', 'embolismo', 'enfisema', 'espiculado', 'espiculación',
  'estenosis', 'esteatosis', 'fibrosis', 'fibrótico', 'fistula', 'fístula',
  'granuloma', 'granulomatoso', 'hemangioma', 'hematoma', 'hemotórax', 'hernia',
  'hiperplasia', 'hipertrofia', 'hipotrofia', 'hipodensidad', 'hiperdensidad',
  'hipointensidad', 'hiperintensidad', 'infarto', 'infiltrado', 'lesión', 'lóculo',
  'lumen', 'masa', 'metástasis', 'metastásico', 'necrosis', 'neoformación', 'nódulo',
  'nodular', 'oclusión', 'opacidad', 'osteoartritis', 'osteófito', 'osteofitosis',
  'osteoporosis', 'osteoporótico', 'plastrón', 'pneumotórax', 'neumotórax', 'pólipo',
  'poliposis', 'pseudoaneurisma', 'quiste', 'quístico', 'reticulonodular', 'trombo',
  'trombosis', 'trombótico', 'tromboembolismo', 'tumor', 'tumoral', 'ulceración',

  // Sistemas de scoring
  'birads', 'bi-rads', 'pirads', 'pi-rads', 'tirads', 'ti-rads', 'lirads', 'li-rads',
  'ctdivol', 'dlp', 'dosimetría', 'dosimétrico',

  // Patologías y diagnósticos
  'adenocarcinoma', 'aneurisma', 'angina', 'appendicitis', 'apéndice', 'artritis',
  'artritis', 'artroscopia', 'aspergilosis', 'asma', 'broncoespasmo', 'bronconeumonía',
  'carcinoma', 'carcinomatosis', 'cirrosis', 'cirrhotica', 'claudicación', 'colecistitis',
  'colelitiasis', 'colitis', 'cólico', 'cólon', 'colon', 'colonopatía', 'coronariografía',
  'crisis', 'criptorquidia', 'diverticulitis', 'divertículo', 'diverticulosis',
  'discopatía', 'disfagia', 'displasia', 'dispnea', 'disnea', 'eclampsia',
  'embolia', 'empiema', 'endometriosis', 'epididimitis', 'espondiloartrosis',
  'espondilosis', 'espondilolistesis', 'espondilolisis', 'espondilopatía',
  'gastritis', 'giardiasis', 'hamartoma', 'hemorragia', 'hemorroides', 'hepatitis',
  'hepatoesplenomegalia', 'hepatomegalia', 'hidrocele', 'hidronefosis', 'hidronefrosis',
  'hipotiroidismo', 'hipertiroidismo', 'ictus', 'infección', 'infertilidad',
  'insuficiencia', 'isquemia', 'isquémico', 'leiomioma', 'lipoma', 'linfoma',
  'litiasis', 'litio', 'lúes', 'meningioma', 'meningitis', 'mioma', 'miomatosis',
  'miositis', 'mieloma', 'nefrolitiasis', 'neoplasia', 'neuropatía', 'neumonía',
  'pericarditis', 'peritonitis', 'policitemia', 'prostatitis', 'pielonefritis',
  'neumocistosis', 'reumatismo', 'sarcoma', 'sepsis', 'séptico', 'shock', 'síncope',
  'tendinitis', 'tendinosis', 'teratoma', 'tiroiditis', 'tuberculosis',

  // Terminología general
  'agudo', 'crónico', 'bilateral', 'unilateral', 'homolateral', 'contralateral',
  'ipsilateral', 'anteroposterior', 'posteroanterior', 'anterolateral', 'posterolateral',
  'caudal', 'craneal', 'cefálico', 'proximal', 'distal', 'periférico', 'central',
  'medial', 'lateral', 'parasagital', 'sagital', 'coronal', 'axial', 'oblicuo',
  'anterosuperior', 'posterosuperior', 'anteroinferior', 'posteroinferior',
  'basal', 'basilar', 'apical', 'apicosegmentario', 'lobar', 'segmentario',
  'subsegmentario', 'lobular', 'lobulado', 'nodulado', 'espiculado', 'lobulillar',
  'parenquimatosa', 'parenquimatoso', 'estromal', 'intersticial', 'subpleural',
  'subpericárdico', 'subcortical', 'subependimario', 'subependimal',
  'heterogéneo', 'homogéneo', 'hipoecoico', 'hiperecoico', 'anecoico', 'ecogénico',
  'hipointenso', 'hiperintenso', 'isointenso', 'heterointensidad', 'tenuemente',
  'obliterado', 'borramiento', 'permeabilidad', 'impronta', 'realce', 'contrast',
  'contraste', 'yodado', 'gadolinio', 'gadolíneo', 'restricción', 'difusión',
  'perfusión', 'ponderada', 'ponderado', 'morfología', 'morfológico', 'topografía',
  'topográfico', 'semiología', 'semiology', 'ecoestructura', 'ecotextura',
]);

/** Checks if a word is in the medical dictionary (case-insensitive) */
export function isMedicalTerm(word: string): boolean {
  return MEDICAL_DICTIONARY.has(word.toLowerCase().replace(/[.,;:!?()[\]{}'"]/g, ''));
}

/**
 * Checks a text for likely misspellings using a basic heuristic:
 *  - Very short words (≤ 3 chars) are skipped
 *  - Words in the medical dictionary are skipped
 *  - Words with digits or all-caps are skipped (abbreviations / lab values)
 *  - Remaining words are checked against a built-in list of common misspellings
 *    in Spanish medical context
 *
 * Returns an array of { word, index, suggestions } objects.
 */
export interface SpellError {
  word: string;
  start: number;
  end: number;
  suggestions: string[];
}

/** Common medical misspellings and their corrections */
const COMMON_MISSPELLINGS: Record<string, string[]> = {
  // Confusión b/v
  'desviasion': ['desviación'],
  'obstruccion': ['obstrucción'],
  'lesion': ['lesión'],
  'intervencion': ['intervención'],
  'infeccion': ['infección'],
  'complicacion': ['complicación'],
  'inflamacion': ['inflamación'],
  'distension': ['distensión'],
  'hipertension': ['hipertensión'],
  'hipotencion': ['hipotensión'],
  // Acentos comunes
  'acido': ['ácido'],
  'utero': ['útero'],
  'higado': ['hígado'],
  'riñon': ['riñón'],
  'pancreas': ['páncreas'],
  'esofago': ['esófago'],
  'traquea': ['tráquea'],
  // Latinismos mal escritos
  'invivo': ['in vivo'],
  'invitro': ['in vitro'],
  'exvivo': ['ex vivo'],
  // Common errors
  'neumonia': ['neumonía'],
  'disfonia': ['disfonía'],
};

/**
 * Runs a spell check on the given text and returns detected errors.
 * This is a lightweight heuristic check — the browser's native spellcheck
 * (enabled via `spellcheck="true" lang="es"`) is the primary mechanism.
 */
export function checkSpelling(text: string): SpellError[] {
  const errors: SpellError[] = [];
  // Match word tokens, preserving position
  const wordRegex = /\b([a-záéíóúüñA-ZÁÉÍÓÚÜÑ]{4,})\b/g;
  let match: RegExpExecArray | null;

  while ((match = wordRegex.exec(text)) !== null) {
    const word = match[1];
    const wordLower = word.toLowerCase();

    // Skip ALL_CAPS (abbreviations)
    if (word === word.toUpperCase()) continue;

    // Skip medical terms
    if (isMedicalTerm(word)) continue;

    // Check against known misspellings
    if (COMMON_MISSPELLINGS[wordLower]) {
      errors.push({
        word,
        start: match.index,
        end:   match.index + word.length,
        suggestions: COMMON_MISSPELLINGS[wordLower],
      });
    }
  }

  return errors;
}

/**
 * Wraps misspelled words in a text string with `<mark>` tags for highlighting.
 * Only used for display purposes — do NOT use the result as innerHTML
 * without sanitization.
 */
export function highlightErrors(text: string, errors: SpellError[]): string {
  if (errors.length === 0) return text;
  let result = '';
  let lastIndex = 0;
  const sorted = [...errors].sort((a, b) => a.start - b.start);
  for (const err of sorted) {
    result += text.slice(lastIndex, err.start);
    result += `<mark class="spell-error" title="Sugerencias: ${err.suggestions.join(', ')}">${err.word}</mark>`;
    lastIndex = err.end;
  }
  result += text.slice(lastIndex);
  return result;
}
