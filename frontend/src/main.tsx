import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { ModulesProvider } from './lib/modules';
import { AppRouter } from './app/router';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ModulesProvider>
          <AppRouter />
        </ModulesProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
