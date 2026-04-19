/**
 * Medical Spanish spell checker.
 * Detects common misspellings in Spanish radiology reports.
 */

export interface SpellError {
  word: string;
  startIndex: number;
  endIndex: number;
  suggestions: string[];
}

const MEDICAL_MISSPELLINGS: Record<string, string[]> = {
  'radiologia':      ['radiología'],
  'cardiologia':     ['cardiología'],
  'tomografia':      ['tomografía'],
  'ecografia':       ['ecografía'],
  'conclusion':      ['conclusión'],
  'consolidacion':   ['consolidación'],
  'calcificacion':   ['calcificación'],
  'inflamacion':     ['inflamación'],
  'alteracion':      ['alteración'],
  'obstruccion':     ['obstrucción'],
  'dilatacion':      ['dilatación'],
  'evaluacion':      ['evaluación'],
  'medicion':        ['medición'],
  'descripcion':     ['descripción'],
  'indicacion':      ['indicación'],
  'neuomotorax':     ['neumotórax'],
  'neumonia':        ['neumonía'],
  'cardiomeglia':    ['cardiomegalia'],
  'esplenomeglia':   ['esplenomegalia'],
  'hepatomeglia':    ['hepatomegalia'],
  'hallasgo':        ['hallazgo'],
  'hallazos':        ['hallazgos'],
  'atelectacia':     ['atelectasia'],
  'bronquiectacia':  ['bronquiectasia'],
  'colecistis':      ['colecistitis'],
  'pancreatisis':    ['pancreatitis'],
  'apendicis':       ['apendicitis'],
  'adenompatia':     ['adenopatía'],
  'hemoraggia':      ['hemorragia'],
  'trombocis':       ['trombosis'],
  'isquemico':       ['isquémico'],
  'isquemica':       ['isquémica'],
  'fractua':         ['fractura'],
  'fractuta':        ['fractura'],
  'luxacion':        ['luxación'],
  'metastacis':      ['metástasis'],
  'metastasis':      ['metástasis'],
  'hiperecogenico':  ['hiperecogénico'],
  'hipoecogenico':   ['hipoecogénico'],
  'parenquima':      ['parénquima'],
  'ventriculo':      ['ventrículo'],
  'auricula':        ['aurícula'],
  'sistolica':       ['sistólica'],
  'diastolica':      ['diastólica'],
  'aortico':         ['aórtico'],
  'aortica':         ['aórtica'],
  'corazon':         ['corazón'],
  'pulmon':          ['pulmón'],
  'higado':          ['hígado'],
  'pancreas':        ['páncreas'],
  'utero':           ['útero'],
  'prostata':        ['próstata'],
  'tirides':         ['tiroides'],
  'tiroide':         ['tiroides'],
  'glandula':        ['glándula'],
  'medula':          ['médula'],
  'diafagma':        ['diafragma'],
};

const KNOWN_CORRECT = new Set([
  'birads','tirads','pirads','lirads','ct','mri','rx','us','pet','nm','mg',
  'ctdivol','dlp','dicom','sop','uid','hounsfield','gy','msv','mgy',
]);

export function checkSpelling(text: string): SpellError[] {
  const errors: SpellError[] = [];
  if (!text.trim()) return errors;
  const wordPattern = /\b[a-záéíóúüñ]+\b/gi;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(text)) !== null) {
    const raw  = match[0];
    const word = raw.toLowerCase();
    if (KNOWN_CORRECT.has(word) || word.length < 4) continue;
    const suggestions = MEDICAL_MISSPELLINGS[word];
    if (suggestions) {
      errors.push({ word: raw, startIndex: match.index, endIndex: match.index + raw.length, suggestions });
    }
  }
  return errors;
}
