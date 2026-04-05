/**
 * Sistema de módulos — hook y contexto
 *
 * Al hacer login, llama a GET /api/system/my-modules y almacena los códigos activos.
 * Provee: useModules() → { modules: string[], hasModule: (code: string) => boolean }
 * Persiste en sessionStorage para no perder al recargar.
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from './api';

interface ModuleInfo {
  code: string;
  name: string;
  version: string;
}

interface ModulesContextValue {
  modules: string[];
  hasModule: (code: string) => boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const SESSION_KEY = 'pacsModules';

const ModulesContext = createContext<ModulesContextValue | null>(null);

export function ModulesProvider({ children }: { children: ReactNode }) {
  const [modules,   setModules]   = useState<string[]>(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [isLoading, setIsLoading] = useState(false);

  const refresh = async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get<ModuleInfo[]>('/system/my-modules');
      const codes = data.map((m) => m.code);
      setModules(codes);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(codes));
    } catch {
      // Non-critical — silently fall back to empty or cached list
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Auto-load on mount if we have a session token (user is logged in)
    const storedUser = sessionStorage.getItem('pacsUser');
    if (storedUser) {
      refresh();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasModule = (code: string) => modules.includes(code);

  return (
    <ModulesContext.Provider value={{ modules, hasModule, isLoading, refresh }}>
      {children}
    </ModulesContext.Provider>
  );
}

export function useModules(): ModulesContextValue {
  const ctx = useContext(ModulesContext);
  if (!ctx) throw new Error('useModules must be used inside ModulesProvider');
  return ctx;
}
