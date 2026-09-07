import FeatureStub from "@/components/FeatureStub";
import { CHAPTER_SPREAD } from "@/lib/nav/chapterReturn";

/* CH.11 - PARTNER DOSSIER
   Deliberately gender-neutral: this chapter used to be "About Him" (route
   /about-him, note "Classified Peter Parker Intel"), which only reads right
   for one of the two people who use this app. Whoever is signed in keeps a
   private file on their other half, so the copy addresses "your partner"
   rather than naming a side of the couple. Owner-only against partner_vault,
   the same non-couple-shared table Ch.10 uses. */

export default function DossierPage() {
  return (
    <FeatureStub
      title="Partner Dossier"
      eyebrow="PRIVATE • OWNER ONLY"
      description="Your own private file on your partner — notes, sizes, favourites, surprises and secret plans."
      table="partner_vault"
      spread={CHAPTER_SPREAD.dossier}
    />
  );
}
