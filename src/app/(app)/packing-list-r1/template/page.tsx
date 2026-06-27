import { getTemplate } from "@/lib/actions/packing-list-r1";
import { getAllCategories } from "@/lib/actions/categories";
import { TemplateEditorClient } from "@/components/packing-list-r1/template-editor-client";

export const dynamic = "force-dynamic";

export default async function PackingListR1TemplatePage() {
  const [template, categories] = await Promise.all([getTemplate(), getAllCategories()]);
  return <TemplateEditorClient template={template} categories={categories} />;
}
