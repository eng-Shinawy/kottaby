"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useAuth } from "@/frontend/hooks/auth";
import { isDashboardDispatcherRedirect } from "@/frontend/lib/auth/roleDashboardRoute";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { isSafeRedirect } from "@/frontend/lib/safeRedirect";
import { Auth, useAppTranslation } from "@/shared/locale";

export function useLoginForm() {
  const t = useAppTranslation(Auth);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login: loginContext } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // After a failed sign-in, keep focus
  // inside the form (first field) instead of dropping it to <body>. The inline
  // role="alert" already announces; this restores a correction-ready anchor.
  const emailInputRef = useRef<HTMLInputElement>(null);
  const failSignInWith = useCallback((message: string) => {
    setErrorMessage(message);
    requestAnimationFrame(() => emailInputRef.current?.focus());
  }, []);
  const handleSubmit = useCallback(
    async (event: React.SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage(null);
      setLoading(true);
      try {
        const ok = await loginContext({ email: email.trim(), password });
        if (!ok) {
          failSignInWith(t.loginError);
          return;
        }
        // Explicit safe `?redirect=` target wins. With NO param, do NOT
        // navigate here: the `(auth)` layout's authenticated-bounce effect
        // owns the fallback and routes by the fresh user role
        // (`resolvePostAuthTarget`). The "/dashboard" dispatcher path — in
        // ANY of its accepted variants ("/dashboard/", "/dashboard?x",
        // "/dashboard#s") — is never pushed: the preview gateway 301s it to
        // "/dashboard/" while Next 308s it back, an infinite browser
        // redirect loop (see `frontend/lib/auth/roleDashboardRoute.ts`).
        const redirectParam = searchParams.get("redirect");
        if (redirectParam && isSafeRedirect(redirectParam) && !isDashboardDispatcherRedirect(redirectParam)) {
          router.push(redirectParam);
        }
      } catch (err) {
        const code = extractErrorCode(err);
        if (code === "UNAUTHORIZED") {
          failSignInWith(t.invalidCredentials);
        } else if (code === "FORBIDDEN") {
          failSignInWith(t.accountBlocked);
        } else {
          failSignInWith(t.loginError);
        }
      } finally {
        setLoading(false);
      }
    },
    [email, password, loginContext, router, searchParams, t, failSignInWith]
  );

  return {
    t,
    email,
    setEmail,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    remember,
    setRemember,
    errorMessage,
    loading,
    emailInputRef,
    handleSubmit,
  };
}
