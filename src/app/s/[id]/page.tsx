import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import { Viewer } from "@/components/viewer";
import { displayName, publicUrl } from "@/lib/screenshot";
import { getScreenshot } from "@/lib/server/data";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const s = await getScreenshot(id);
  return { title: s ? displayName(s.name) : "Not found" };
}

export default async function ScreenshotPage({ params }: Props) {
  const { id } = await params;
  const screenshot = await getScreenshot(id);
  if (!screenshot) notFound();
  // Start the whole-image preview before anything else on the page.
  if (screenshot.preview_path) preload(publicUrl(screenshot.preview_path), { as: "image", fetchPriority: "high" });
  return <Viewer key={screenshot.id} screenshot={screenshot} mode="owner" />;
}
