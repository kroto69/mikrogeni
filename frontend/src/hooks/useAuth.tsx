import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  AUTH_CHANGE_EVENT,
  clearStoredAuthSession,
  getStoredAuthSession,
  loginRequest,
  setStoredAuthSession,
  type AuthSession,
  type LoginPayload,
} from "@/lib/api";

function decodeJwtRole(token: string): string {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return decoded.role || "user";
  } catch {
    return "user";
  }
}

type AuthContextValue = {
  user: { username: string; role: string } | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginPayload) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const navigate = useNavigate();
  const [session, setSession] = useState<AuthSession | null>(() => getStoredAuthSession());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setSession(getStoredAuthSession());
    setIsLoading(false);

    if (typeof window === "undefined") {
      return undefined;
    }

    const syncSession = () => setSession(getStoredAuthSession());

    window.addEventListener(AUTH_CHANGE_EVENT, syncSession as EventListener);
    window.addEventListener("storage", syncSession);

    return () => {
      window.removeEventListener(AUTH_CHANGE_EVENT, syncSession as EventListener);
      window.removeEventListener("storage", syncSession);
    };
  }, []);

  const login = useCallback(
    async (credentials: LoginPayload) => {
      const response = await loginRequest(credentials);

      const nextSession: AuthSession = {
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresIn: response.expires_in,
        username: credentials.username,
        role: decodeJwtRole(response.access_token),
      };

      setStoredAuthSession(nextSession);
      setSession(nextSession);
      navigate("/dashboard", { replace: true });
    },
    [navigate],
  );

  const logout = useCallback(() => {
    clearStoredAuthSession();
    setSession(null);
    navigate("/login", { replace: true });
  }, [navigate]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session ? { username: session.username, role: session.role } : null,
      accessToken: session?.accessToken ?? null,
      isAuthenticated: Boolean(session?.accessToken),
      isLoading,
      login,
      logout,
    }),
    [isLoading, login, logout, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
