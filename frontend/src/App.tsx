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
import { OltSelectorProvider } from "@/hooks/useOltSelector";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Login = lazy(() => import("@/pages/Login"));
const MikrotikDetail = lazy(() => import("@/pages/Mikrotik/Detail"));
const MikrotikIndex = lazy(() => import("@/pages/Mikrotik"));
const BillingIndex = lazy(() => import("@/pages/Billing"));
const OnuDetail = lazy(() => import("@/pages/ONU/Detail"));
const OnuIndex = lazy(() => import("@/pages/ONU"));
const PluginPage = lazy(() => import("@/pages/Plugin"));
const OltHiosoPage = lazy(() => import("@/pages/Plugin/OltHioso"));
const OltZtePage = lazy(() => import("@/pages/Plugin/OltZte"));
const OLTManagementPage = lazy(() => import("@/pages/OLTManagement"));
const Settings = lazy(() => import("@/pages/Settings"));

function AuthBoundary({ children, guestOnly = false }: { children: ReactNode; guestOnly?: boolean }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
          <div className="neo-panel rounded-2xl border border-border bg-card px-6 py-4 text-sm text-muted-foreground">
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
        <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
          <div className="neo-panel rounded-2xl border border-border bg-card px-6 py-4 text-sm text-muted-foreground">
            Loading interface...
          </div>
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
          <Route path="plugin" element={<Outlet />}>
            <Route index element={<PluginPage />} />
            <Route path="olt/hioso" element={<OltHiosoPage />} />
          </Route>
          <Route path="zte" element={<OltZtePage />} />
          <Route path="olt-management" element={<OLTManagementPage />} />
          <Route path="settings" element={<Settings />} />
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
        <OltSelectorProvider>
          <AppRoutes />
        </OltSelectorProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
