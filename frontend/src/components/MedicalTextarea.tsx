/**
 * MedicalTextarea — Sección 19: Spell check médico en español
 *
 * Un textarea con:
 *  1. spellcheck nativo del navegador activado con lang="es"
 *  2. Análisis JS de errores ortográficos conocidos en terminología médica
 *  3. Indicador de errores detectados con sugerencias
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { checkSpelling, SpellError } from '../lib/medicalSpellCheck';

interface MedicalTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
  /** If true, shows spell-check error count badge */
  showSpellCheck?: boolean;
  id?: string;
}

export function MedicalTextarea({
  value,
  onChange,
  placeholder,
  rows = 6,
  disabled = false,
  className = '',
  showSpellCheck = true,
  id,
}: MedicalTextareaProps) {
  const [spellErrors, setSpellErrors] = useState<SpellError[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Run spell check 600ms after the user stops typing
  const runSpellCheck = useCallback((text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const errors = checkSpelling(text);
      setSpellErrors(errors);
    }, 600);
  }, []);

  useEffect(() => {
    runSpellCheck(value);
  }, [value, runSpellCheck]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={className}
        // Native browser spell check in Spanish
        spellCheck
        lang="es"
        style={{ width: '100%', resize: 'vertical' }}
      />

      {showSpellCheck && spellErrors.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setShowErrors((p) => !p)}
            style={{
              fontSize: 11,
              color: '#b45309',
              background: '#fef3c7',
              border: '1px solid #fcd34d',
              borderRadius: 4,
              padding: '2px 8px',
              cursor: 'pointer',
            }}
          >
            ⚠ {spellErrors.length} posible{spellErrors.length > 1 ? 's' : ''} error{spellErrors.length > 1 ? 'es' : ''} ortográfico{spellErrors.length > 1 ? 's' : ''}
            {showErrors ? ' ▲' : ' ▼'}
          </button>

          {showErrors && (
            <div
              style={{
                marginTop: 4,
                padding: '6px 10px',
                background: '#fffbeb',
                border: '1px solid #fcd34d',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {spellErrors.map((err, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <span style={{ color: '#92400e', fontWeight: 600 }}>"{err.word}"</span>
                  {err.suggestions.length > 0 && (
                    <span style={{ color: '#374151' }}>
                      {' '}→ Sugerencia{err.suggestions.length > 1 ? 's' : ''}:{' '}
                      {err.suggestions.map((s, si) => (
                        <button
                          key={si}
                          type="button"
                          title={`Reemplazar "${err.word}" por "${s}"`}
                          onClick={() => {
                            // Replace first occurrence of the misspelled word
                            const updated = value.slice(0, err.start) + s + value.slice(err.end);
                            onChange(updated);
                          }}
                          style={{
                            color: '#1d4ed8',
                            background: 'none',
                            border: 'none',
                            padding: '0 2px',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            fontSize: 12,
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              ))}
              <div style={{ marginTop: 6, color: '#78350f', fontSize: 11 }}>
                💡 El corrector ortográfico del navegador (lang="es") también está activo.
                Para agregar términos médicos personalizados, agregue la palabra al diccionario
                del navegador con clic derecho → "Agregar al diccionario".
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
