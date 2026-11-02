import { Gallery } from "@/components/gallery";
import { listScreenshots } from "@/lib/server/data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const screenshots = await listScreenshots();
  return <Gallery initial={screenshots} />;
}
