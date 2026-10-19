import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ErrorBoundary } from './components/error-boundary';
import './styles/globals.css';
const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, gcTime: 60_000 } } });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><QueryClientProvider client={client}><App/></QueryClientProvider></ErrorBoundary></React.StrictMode>);