"use client";

import { useSearchParams } from "next/navigation";
import { tocReturnHref } from "./chapterReturn";

/**
 * Client-side twin of `tocReturnHref`. Must be used under a <Suspense>
 * boundary, which every chapter route already provides.
 */
export function useTocReturn(fallbackSpread: number): string {
  const searchParams = useSearchParams();
  return tocReturnHref(searchParams?.get("from"), fallbackSpread);
}
