import { Suspense, lazy, type ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import MainLayout from "@/components/layout/MainLayout";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { routeLoaders } from "@/lib/routePreload";

const Dashboard = lazy(routeLoaders.dashboard);
const Login = lazy(routeLoaders.login);
const MikrotikDetail = lazy(routeLoaders.mikrotikDetail);
const MikrotikIndex = lazy(routeLoaders.mikrotik);
const BillingIndex = lazy(routeLoaders.billing);
const OnuDetail = lazy(routeLoaders.onuDetail);
const OnuIndex = lazy(routeLoaders.onu);
const OltHiosoPage = lazy(routeLoaders.hioso);
const Settings = lazy(routeLoaders.settings);
const LogsPage = lazy(routeLoaders.logs);
const ZTEONUListPage = lazy(routeLoaders.zte);

function AuthBoundary({ children, guestOnly = false }: { children: ReactNode; guestOnly?: boolean }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
          <div className="neo-panel rounded-lg border-2 border-border bg-card px-6 py-4 text-sm text-muted-foreground">
            Preparing your workspace...
          </div>
        </div>
    );
  }

  if (guestOnly && isAuthenticated) {
    return <Navigate replace to="/dashboard" />;
  }

  if (!guestOnly && !isAuthenticated) {
    return <Navigate replace to="/login" state={{ from: location }} />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background" role="status" aria-label="Memuat antarmuka">
          <div className="global-progress" />
        </div>
      }
    >
      <Routes>
        <Route
          path="/login"
          element={
            <AuthBoundary guestOnly>
              <Login />
            </AuthBoundary>
          }
        />

        <Route
          path="/"
          element={
            <AuthBoundary>
              <MainLayout />
            </AuthBoundary>
          }
        >
          <Route index element={<Navigate replace to="/dashboard" />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="onu" element={<Outlet />}>
            <Route index element={<OnuIndex />} />
            <Route path=":id" element={<OnuDetail />} />
          </Route>
          <Route path="mikrotik" element={<Outlet />}>
            <Route index element={<MikrotikIndex />} />
            <Route path=":deviceId" element={<MikrotikDetail />} />
          </Route>
          <Route path="billing" element={<BillingIndex />} />
          <Route path="hioso" element={<OltHiosoPage />} />
          <Route path="zte/:connId" element={<ZTEONUListPage />} />
          <Route path="settings" element={<Settings />} />
          <Route path="logs" element={<LogsPage />} />
        </Route>

        <Route path="*" element={<Navigate replace to="/dashboard" />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
