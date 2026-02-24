"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function SignInCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [message, setMessage] = useState<string>("Finishing GitHub sign-in...");

  const status = params.get("status");
  const login = params.get("login");
  const oauthError = params.get("error_description") ?? params.get("error");
  const decodedError = useMemo(() => {
    if (!oauthError) return null;
    try {
      return decodeURIComponent(oauthError);
    } catch {
      return oauthError;
    }
  }, [oauthError]);

  useEffect(() => {
    if (decodedError) {
      setMessage(`GitHub sign-in failed: ${decodedError}`);
      return;
    }
    if (status !== "ok") {
      setMessage("Sign-in did not complete.");
      return;
    }
    setMessage(`Signed in as @${login ?? "user"}. Redirecting...`);
    window.setTimeout(() => router.replace("/signin"), 700);
  }, [decodedError, login, router, status]);

  return (
    <section>
      <h1>Sign in callback</h1>
      <p>{message}</p>
    </section>
  );
}

export default function SignInCallbackPage() {
  return (
    <Suspense
      fallback={
        <section>
          <h1>Sign in callback</h1>
          <p>Finishing GitHub sign-in...</p>
        </section>
      }
    >
      <SignInCallbackInner />
    </Suspense>
  );
}
