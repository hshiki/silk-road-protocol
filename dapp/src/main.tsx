import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { EveFrontierProvider } from '@evefrontier/dapp-kit';
import App from './App';
import './index.css';

const queryClient = new QueryClient();

// Prevent VaultProvider auto-connect bug (double modal on init).
// Users connect manually via the Connect button.
localStorage.removeItem('eve-dapp-connected');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <EveFrontierProvider queryClient={queryClient}>
    <App />
  </EveFrontierProvider>,
);
