"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import {
  ArrowRight,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  Mail,
  Lock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Please enter your Gmail or email address")
    .email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type SignInFormValues = z.infer<typeof signInSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSignInSubmit = async (values: SignInFormValues) => {
    setIsLoading(true);
    setAuthError(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email.trim().toLowerCase(),
        password: values.password,
      });

      if (error) {
        const lower = error.message.toLowerCase();
        if (lower.includes("banned") || error.code === "user_banned") {
          setAuthError(
            "Your account has been deactivated by an Administrator. Please contact an Admin."
          );
        } else if (lower.includes("invalid login credentials")) {
          setAuthError(
            "Invalid email or password. Please contact your Administrator if you need an account."
          );
        } else {
          setAuthError(error.message);
        }
        setIsLoading(false);
        return;
      }

      // Verify active account status in database
      const checkRes = await fetch("/api/auth/check-account", {
        cache: "no-store",
      });
      if (!checkRes.ok) {
        const checkJson = await checkRes.json().catch(() => ({}));
        await supabase.auth.signOut();
        setAuthError(
          checkJson.error ||
            "Your account is currently inactive. Please contact an Administrator."
        );
        setIsLoading(false);
        return;
      }

      router.push("/schedule");
      router.refresh();
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : "Failed to sign in. Please try again."
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex flex-col items-center justify-center">
          <div className="h-28 w-28 overflow-hidden flex items-center justify-center">
            <Image
              src="/KIT-Music_Lesson-Logo_Black.svg"
              alt="KitMusicLesson Logo"
              width={140}
              height={140}
              priority
              className="h-36 w-36 max-w-none object-contain"
            />
          </div>
        </div>

        <h1 className="mt-2 text-center text-2xl font-semibold tracking-tight text-zinc-900">
          Sign in to KitMusicLesson
        </h1>
        <p className="mt-1.5 text-center text-sm text-zinc-500">
          Enter your registered Gmail address and password
        </p>
      </div>

      <div className="mt-7 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-7 px-6 shadow-xs rounded-2xl border border-zinc-200/80 sm:px-8">
          {authError && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl bg-red-50/90 border border-red-200 p-3.5 text-xs text-red-700 leading-relaxed">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          <form
            className="space-y-4"
            onSubmit={handleSubmit(onSignInSubmit)}
            noValidate
          >
            <div>
              <label
                htmlFor="signin-email"
                className="block text-xs font-medium text-zinc-700 mb-1.5"
              >
                Gmail / Email Address
              </label>
              <div className="relative">
                <Mail className="h-4 w-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="signin-email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@gmail.com"
                  {...register("email")}
                  className="block w-full rounded-lg border border-zinc-200 bg-white pl-10 pr-3.5 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-hidden focus:ring-1 focus:ring-zinc-900 transition-colors"
                />
              </div>
              {errors.email && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="signin-password"
                className="block text-xs font-medium text-zinc-700 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="h-4 w-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="signin-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  {...register("password")}
                  className="block w-full rounded-lg border border-zinc-200 bg-white pl-10 pr-10 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-hidden focus:ring-1 focus:ring-zinc-900 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.password.message}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-hidden focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 disabled:opacity-60 transition-colors cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-zinc-100 text-center">
            <p className="text-xs text-zinc-400">
              Need an account? Accounts are created manually by your
              KitMusicLesson Administrator.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
