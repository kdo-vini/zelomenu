import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { HomePage } from './pages/HomePage';
import ZeloMenuStorePage from './pages/ZeloMenuStorePage';
import ZeloMenuCartPage from './pages/ZeloMenuCartPage';
import { ZeloMenuMesaPage } from './pages/ZeloMenuMesaPage';

const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })));

function RouteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-line)] border-t-[var(--color-brand)]" aria-label="Carregando" />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="/menu/carrinho/:token" element={<ZeloMenuCartPage />} />
              <Route path="/:slug/mesa/:mesaId" element={<ZeloMenuMesaPage />} />
              <Route path="/:slug" element={<ZeloMenuStorePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
