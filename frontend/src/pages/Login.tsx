import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { getApiErrorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import LoginLogo from "@/images/logo.png";

const LOGIN_IMAGE_SOURCE = "/images/login-cover.png";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showLoginImage, setShowLoginImage] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login({ username, password });
    } catch (submitError) {
      setError(getApiErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="route-shell route-shell-login relative flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-sm space-y-3">
        {showLoginImage ? (
          <div className="route-shell-panel overflow-hidden rounded-lg border-2 border-border bg-card shadow-brutal-sm">
            <img
              alt="MIKROGENI Login"
              className="h-28 w-full object-cover"
              onError={() => setShowLoginImage(false)}
              src={LOGIN_IMAGE_SOURCE}
            />
          </div>
        ) : null}

        <Card className="route-shell-panel w-full border-2 border-border bg-card/95 shadow-brutal">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex w-full items-center justify-center rounded-lg border-2 border-border bg-primary p-3 shadow-brutal-sm">
            <img alt="NC MIKROGENI" className="h-20 w-auto object-contain" src={LoginLogo} />
          </div>
          <CardDescription className="text-foreground">v4.1</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="username">
              Username
            </label>
              <Input id="username" value={username} onChange={(event) => setUsername(event.target.value)} />
            </div>
            <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="password">
              Password
            </label>
              <div className="relative">
                <Input
                  id="password"
                  autoComplete="current-password"
                  className="pr-12"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded border border-border bg-card text-foreground shadow-brutal-sm hover:bg-accent"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error ? <p className="rounded-lg border-2 border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p> : null}

            <Button className="w-full" disabled={isSubmitting} size="lg" type="submit">
              {isSubmitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
