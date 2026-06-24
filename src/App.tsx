import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { AdminPage } from './pages/AdminPage';
import { HomePage } from './pages/HomePage';
import ZeloMenuStorePage from './pages/ZeloMenuStorePage';
import ZeloMenuCartPage from './pages/ZeloMenuCartPage';

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/menu/carrinho/:token" element={<ZeloMenuCartPage />} />
            <Route path="/:slug" element={<ZeloMenuStorePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
