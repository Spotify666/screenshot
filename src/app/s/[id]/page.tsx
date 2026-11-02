import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Viewer } from "@/components/viewer";
import { displayName, publicUrl } from "@/lib/screenshot";
import { getScreenshot } from "@/lib/server/data";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const s = await getScreenshot(id);
  if (!s) return { title: "Not found" };
  return {
    title: displayName(s.name),
    openGraph: { images: [{ url: publicUrl(s.thumb_path), width: s.thumb_width, height: s.thumb_height }] },
  };
}

export default async function ScreenshotPage({ params }: Props) {
  const { id } = await params;
  const screenshot = await getScreenshot(id);
  if (!screenshot) notFound();
  return <Viewer key={screenshot.id} screenshot={screenshot} />;
}
