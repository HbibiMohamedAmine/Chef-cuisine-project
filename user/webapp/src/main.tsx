import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider, ReferentialsProvider, ToastProvider } from './lib/app-context';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <ReferentialsProvider>
            <App />
          </ReferentialsProvider>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  </React.StrictMode>,
);
