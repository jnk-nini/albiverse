import FeatureStub from "@/components/FeatureStub";
import { CHAPTER_SPREAD } from "@/lib/nav/chapterReturn";

export default function WishlistPage() {
  return <FeatureStub title="Gift Wishlist" eyebrow="PRIVATE IDEAS • SURPRISES" description="A private list for gifts, links, priorities, and surprise planning." table="partner_vault" spread={CHAPTER_SPREAD.wishlist} />;
}
