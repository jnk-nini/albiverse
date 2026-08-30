"use client";

import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";
import { useTocReturn } from "@/lib/nav/useTocReturn";

interface FeatureStubProps {
  title: string;
  eyebrow: string;
  description: string;
  table: string;
  /* The spread this chapter sits on in the table of contents, used only when
     the reader arrived without a `?from=` (a bookmark, a typed URL). */
  spread?: number;
}

function StubShell({
  title,
  eyebrow,
  description,
  table,
  backHref,
}: Omit<FeatureStubProps, "spread"> & { backHref: string }) {
  return (
    <main className="min-h-screen bg-[#28313B] p-5 sm:p-10 text-[#261D24]">
      <div className="max-w-6xl mx-auto">
        <Link href={backHref} className="inline-flex items-center gap-2 text-[#E0B1AE] font-mono text-xs mb-8">
          <ArrowLeft className="w-4 h-4" /> BACK TO SCRAPBOOK
        </Link>
        <section className="paper-sheet-solid min-h-[75vh] p-8 sm:p-14">
          <span className="font-mono text-[11px] tracking-[.25em] text-[#7D2834]">{eyebrow}</span>
          <h1 className="font-marker text-5xl sm:text-8xl mt-3">{title}</h1>
          <p className="font-handwriting text-3xl text-[#5A2029] max-w-2xl mt-4">{description}</p>
          <div className="mt-14 border-4 border-dashed border-[#C5A467] p-8 max-w-xl rotate-1">
            <Construction className="w-10 h-10 text-[#7D2834]" />
            <h2 className="font-marker text-3xl mt-5">Chapter scaffolded</h2>
            <p className="font-mono text-xs text-[#5A2029] mt-3 leading-relaxed">
              This feature has its own screen and is reserved for CRUD wiring against <strong>{table}</strong>.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function FeatureStubInner({ spread = 0, ...rest }: FeatureStubProps) {
  /* The old link pointed at `/?view=contents`, which the dashboard does not
     recognise, so leaving a stub closed the book. It now returns to the spread
     the reader opened the chapter from, like every other chapter. */
  const backHref = useTocReturn(spread);
  return <StubShell {...rest} backHref={backHref} />;
}

export default function FeatureStub(props: FeatureStubProps) {
  return (
    <Suspense
      fallback={<StubShell {...props} backHref={`/?opened=true&spread=${props.spread ?? 0}`} />}
    >
      <FeatureStubInner {...props} />
    </Suspense>
  );
}
