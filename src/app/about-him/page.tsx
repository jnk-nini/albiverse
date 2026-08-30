import FeatureStub from "@/components/FeatureStub";
import { CHAPTER_SPREAD } from "@/lib/nav/chapterReturn";

export default function AboutHimPage() {
  return <FeatureStub title="About Him Portal" eyebrow="PRIVATE • OWNER ONLY" description="A separate private portal for dossier notes, surprises, gifts, and secret plans." table="partner_vault" spread={CHAPTER_SPREAD["about-him"]} />;
}
