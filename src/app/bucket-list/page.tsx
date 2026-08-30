import FeatureStub from "@/components/FeatureStub";
import { CHAPTER_SPREAD } from "@/lib/nav/chapterReturn";

export default function BucketListPage() {
  return <FeatureStub title="Bucket List" eyebrow="ADVENTURES • SHARED GOALS" description="A corkboard of places, food, plans, proof photos, and finished quests." table="bucket_list" spread={CHAPTER_SPREAD["bucket-list"]} />;
}
