import { useRef, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
}

export function RichTextEditor({ value, onChange, placeholder, minHeight = 110, disabled = false }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Track if the editor is focused to avoid cursor jumps on external value updates
  const isFocused = useRef(false);

  // Initialize / sync content when value changes externally (not while focused)
  useEffect(() => {
    if (ref.current && !isFocused.current && ref.current.innerHTML !== value) {
      // Sanitize before assigning to innerHTML to prevent stored XSS
      ref.current.innerHTML = DOMPurify.sanitize(value, { USE_PROFILES: { html: true } });
    }
  }, [value]);

  const execCmd = useCallback((command: string, arg?: string) => {
    document.execCommand(command, false, arg);
    ref.current?.focus();
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Ctrl/Cmd + B → bold, I → italic, U → underline
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b') { e.preventDefault(); execCmd('bold'); }
      else if (e.key === 'i') { e.preventDefault(); execCmd('italic'); }
      else if (e.key === 'u') { e.preventDefault(); execCmd('underline'); }
    }
  }, [execCmd]);

  const isEmpty = !value || value === '<br>' || value === '<p><br></p>' || value === '';

  return (
    <div style={{ border: '1px solid var(--gray-300)', borderRadius: 6, overflow: 'hidden', opacity: disabled ? 0.6 : 1 }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', gap: 2, padding: '4px 8px',
        background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)'
      }}>
        {[
          { cmd: 'bold',          label: <strong>B</strong>,         title: 'Negrita (Ctrl+B)' },
          { cmd: 'italic',        label: <em>I</em>,                  title: 'Cursiva (Ctrl+I)' },
          { cmd: 'underline',     label: <u>U</u>,                    title: 'Subrayado (Ctrl+U)' },
          { cmd: 'insertUnorderedList', label: '≡',                  title: 'Lista' },
          { cmd: 'insertOrderedList',   label: '1.',                  title: 'Lista numerada' },
        ].map(({ cmd, label, title }) => (
          <button
            key={cmd}
            type="button"
            title={title}
            disabled={disabled}
            onMouseDown={(e) => { e.preventDefault(); execCmd(cmd); }}
            style={{
              width: 28, height: 26,
              background: 'none', border: '1px solid transparent', borderRadius: 3,
              cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--gray-700)'
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gray-200)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Editable area */}
      <div style={{ position: 'relative' }}>
        {isEmpty && !isFocused.current && (
          <div
            style={{
              position: 'absolute', top: 8, left: 10,
              color: 'var(--gray-400)', fontSize: 13, pointerEvents: 'none',
              lineHeight: 1.5
            }}
          >
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={handleInput}
          onFocus={() => { isFocused.current = true; }}
          onBlur={() => { isFocused.current = false; if (ref.current) onChange(ref.current.innerHTML); }}
          onKeyDown={handleKeyDown}
          style={{
            minHeight,
            padding: '8px 10px',
            outline: 'none',
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--gray-800)',
            overflowY: 'auto'
          }}
        />
      </div>
    </div>
  );
}
