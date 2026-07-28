import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';

const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })));
const ZeloMenuInfoPage = lazy(() => import('./pages/ZeloMenuInfoPage').then((module) => ({ default: module.ZeloMenuInfoPage })));
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage').then((module) => ({ default: module.AuthCallbackPage })));
const ZeloMenuStorePage = lazy(() => import('./pages/ZeloMenuStorePage'));
const ZeloMenuCartPage = lazy(() => import('./pages/ZeloMenuCartPage'));
const ZeloMenuMesaPage = lazy(() => import('./pages/ZeloMenuMesaPage').then((module) => ({ default: module.ZeloMenuMesaPage })));

function RouteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-line)] border-t-[var(--color-brand)]" aria-label="Carregando" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/conhecer-zelomenu" element={<ZeloMenuInfoPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/menu/carrinho/:token" element={<ZeloMenuCartPage />} />
          <Route path="/:slug/mesa/:mesaId" element={<ZeloMenuMesaPage />} />
          <Route path="/:slug" element={<ZeloMenuStorePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
